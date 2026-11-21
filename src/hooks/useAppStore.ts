// アプリ全体の状態管理・非同期AIレポート再試行・1問ごとの自動保存フック

import { useCallback, useEffect, useState } from 'react';
import {
  commitValidatedBackupToDb,
  type ValidatedBackupBundle,
} from '../db/backup';
import {
  initializeAndLoadAppData,
  saveAiReportToDb,
  saveChunksToDb,
  saveCoachMessageToDb,
  saveQuestionProgressTransaction,
  saveSessionToDb,
  saveSettingsToDb,
} from '../db/database';
import {
  checkLv1PhaseTransition,
  lockCoreSetForLevel,
} from '../domain/promotionGate';
import { createInitialReviewState, updateReviewState } from '../domain/srs';
import {
  evaluateStreakAndTickets,
  getStudyDate,
} from '../domain/studyDate';
import { runFourAiEmployeesPipeline } from '../services/geminiService';
import {
  DEFAULT_SETTINGS,
  type AiReport,
  type Attempt,
  type Chunk,
  type CoachMessage,
  type Level,
  type ReviewState,
  type Session,
  type Settings,
} from '../types';

export function useAppStore() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [reviewStates, setReviewStates] = useState<ReviewState[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [aiReports, setAiReports] = useState<AiReport[]>([]);
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([]);
  const [streakDays, setStreakDays] = useState(0);
  const [suggestRehab, setSuggestRehab] = useState(false);
  const [justPromotedBanner, setJustPromotedBanner] = useState(false);

  // pending状態のAIレポートを非同期に処理する（最大3回リトライ、失敗したら status:'failed'）
  const processPendingAiReports = useCallback(
    async (
      currentReports: AiReport[],
      currentAttempts: Attempt[],
      currentChunks: Chunk[],
      currentSettings: Settings
    ) => {
      const pendings = currentReports.filter((r) => r.status === 'pending');
      if (pendings.length === 0) return;

      for (const report of pendings) {
        if (report.retryCount >= 3) {
          const failedReport: AiReport = { ...report, status: 'failed' };
          await saveAiReportToDb(failedReport);
          setAiReports((prev) =>
            prev.map((r) => (r.id === failedReport.id ? failedReport : r))
          );
          continue;
        }

        const sessionAttempts = currentAttempts.filter(
          (a) => a.sessionId === report.sessionId
        );

        const result = await runFourAiEmployeesPipeline({
          sessionAttempts,
          existingChunks: currentChunks,
          settings: currentSettings,
        });

        const today = getStudyDate();
        let nextSettings = currentSettings;
        if (result.apiCallsMade > 0) {
          const prevCount =
            currentSettings.apiCallDate === today
              ? (currentSettings.apiCallCount ?? 0)
              : 0;
          nextSettings = {
            ...currentSettings,
            apiCallDate: today,
            apiCallCount: prevCount + result.apiCallsMade,
          };
          await saveSettingsToDb(nextSettings);
          setSettings(nextSettings);
        }

        // 429エラー時は retryCount を増やし、3回以上なら failed、未満なら pending のままでもモック結果を格納
        if (result.rateLimited) {
          const nextRetry = report.retryCount + 1;
          const nextStatus = nextRetry >= 3 ? 'failed' : 'pending';
          const updated: AiReport = {
            ...report,
            retryCount: nextRetry,
            status: nextStatus,
            analyst: result.analyst,
            teacher: result.teacher,
          };
          await saveAiReportToDb(updated);
          setAiReports((prev) =>
            prev.map((r) => (r.id === updated.id ? updated : r))
          );
          continue;
        }

        if (result.newChunks.length > 0) {
          await saveChunksToDb(result.newChunks);
          setChunks((prev) => {
            const existingIds = new Set(prev.map((c) => c.id));
            const uniqueNew = result.newChunks.filter(
              (c) => !existingIds.has(c.id)
            );
            return [...prev, ...uniqueNew];
          });
        }

        const doneReport: AiReport = {
          ...report,
          status: 'done',
          analyst: result.analyst,
          teacher: result.teacher,
        };
        await saveAiReportToDb(doneReport);
        setAiReports((prev) =>
          prev.map((r) => (r.id === doneReport.id ? doneReport : r))
        );
      }
    },
    []
  );

  // 初回ロード
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const data = await initializeAndLoadAppData();
      if (!mounted) return;

      const today = getStudyDate();
      const activeDates = data.sessions
        .filter((s) => s.activeSeconds > 0)
        .map((s) => s.studyDate);

      const streakEval = evaluateStreakAndTickets({
        currentStudyDate: today,
        activeStudyDates: activeDates,
        currentTickets: data.settings.restTickets,
        lastTicketRefillWeek: data.settings.lastTicketRefillWeek,
        lastEvaluatedStudyDate: data.settings.lastEvaluatedStudyDate,
      });

      const updatedSettings: Settings = {
        ...data.settings,
        restTickets: streakEval.restTickets,
        lastTicketRefillWeek: streakEval.lastTicketRefillWeek,
        lastEvaluatedStudyDate: streakEval.lastEvaluatedStudyDate,
      };
      await saveSettingsToDb(updatedSettings);

      setSettings(updatedSettings);
      setChunks(data.chunks);
      setReviewStates(data.reviewStates);
      setAttempts(data.attempts);
      setSessions(data.sessions);
      setAiReports(data.aiReports);
      setCoachMessages(data.coachMessages);
      setStreakDays(streakEval.streakDays);
      setSuggestRehab(streakEval.suggestRehab);
      setLoading(false);

      // 起動時に未完了（pending）のAIレポートがあれば再実行
      void processPendingAiReports(
        data.aiReports,
        data.attempts,
        data.chunks,
        updatedSettings
      );
    })();
    return () => {
      mounted = false;
    };
  }, [processPendingAiReports]);

  // 設定の更新
  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next: Settings = { ...settings, ...patch };
      setSettings(next);
      await saveSettingsToDb(next);
      return next;
    },
    [settings]
  );

  // 1問ごとの自動保存（Attempt + ReviewState + Session.activeSeconds を1トランザクションで保存）
  // updateSrs: false の場合（スリープモードやLv.0診断）はSRSを更新しない
  const recordQuestionAttempt = useCallback(
    async (params: {
      attempt: Attempt;
      session: Session;
      updateSrs?: boolean;
    }) => {
      const { attempt, session, updateSrs = true } = params;
      let nextReviewState: ReviewState | undefined;

      if (updateSrs) {
        const existingState =
          reviewStates.find((s) => s.chunkId === attempt.chunkId) ??
          createInitialReviewState(attempt.chunkId, attempt.studyDate);
        nextReviewState = updateReviewState(
          existingState,
          attempt.rating,
          attempt.studyDate,
          attempt.exerciseType
        );
      }

      await saveQuestionProgressTransaction({
        attempt,
        reviewState: nextReviewState,
        session,
      });

      const nextAttempts = [...attempts, attempt];
      setAttempts(nextAttempts);

      if (nextReviewState) {
        setReviewStates((prev) => {
          const idx = prev.findIndex((s) => s.chunkId === nextReviewState.chunkId);
          if (idx === -1) return [...prev, nextReviewState];
          const copy = [...prev];
          copy[idx] = nextReviewState;
          return copy;
        });
      }

      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === session.id);
        const nextList = idx === -1 ? [...prev, session] : prev.map((s) => (s.id === session.id ? session : s));
        const activeDates = nextList
          .filter((s) => s.activeSeconds > 0)
          .map((s) => s.studyDate);
        const streakEval = evaluateStreakAndTickets({
          currentStudyDate: getStudyDate(),
          activeStudyDates: activeDates,
          currentTickets: settings.restTickets,
          lastTicketRefillWeek: settings.lastTicketRefillWeek,
          lastEvaluatedStudyDate: settings.lastEvaluatedStudyDate,
        });
        setStreakDays(streakEval.streakDays);
        setSuggestRehab(false);
        return nextList;
      });

      // Lv.1前半（絵カード期）→後半（語順ブロック期）の自動移行判定
      if (settings.level === 1 && settings.lv1Phase === 'picture') {
        const phaseCheck = checkLv1PhaseTransition(nextAttempts);
        if (phaseCheck.readyForBlocks) {
          await updateSettings({ lv1Phase: 'blocks' });
        }
      }
    },
    [attempts, reviewStates, settings, updateSettings]
  );

  // セッション終了と非同期AIレポート登録・実行
  const completeSessionWithAiReport = useCallback(
    async (finishedSession: Session) => {
      await saveSessionToDb(finishedSession);
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === finishedSession.id);
        if (idx === -1) return [...prev, finishedSession];
        return prev.map((s) => (s.id === finishedSession.id ? finishedSession : s));
      });

      const pendingReport: AiReport = {
        id: `report_${finishedSession.id}`,
        sessionId: finishedSession.id,
        studyDate: finishedSession.studyDate,
        status: 'pending',
        retryCount: 0,
        createdAt: Date.now(),
      };
      await saveAiReportToDb(pendingReport);
      const nextReports = [...aiReports, pendingReport];
      setAiReports(nextReports);

      // 裏側で非同期に4人のAI社員パイプラインを実行
      void processPendingAiReports(
        [pendingReport],
        attempts,
        chunks,
        settings
      );
    },
    [aiReports, attempts, chunks, processPendingAiReports, settings]
  );

  // 「不自然」報告ボタンによる問題の無効化（disabled = true）
  const markChunkUnnatural = useCallback(
    async (chunkId: string) => {
      const target = chunks.find((c) => c.id === chunkId);
      if (!target) return;
      const updated: Chunk = { ...target, disabled: true };
      await saveChunksToDb([updated]);
      setChunks((prev) => prev.map((c) => (c.id === chunkId ? updated : c)));
    },
    [chunks]
  );

  // ボス戦合格によるレベル昇格（Lv.2〜4のコアセット40チャンクを固定）
  const promoteToLevel = useCallback(
    async (nextLevel: Level) => {
      const lockedChunks = lockCoreSetForLevel(nextLevel, chunks);
      await saveChunksToDb(lockedChunks);
      setChunks(lockedChunks);
      await updateSettings({
        level: nextLevel,
        bossCooldownUntil: undefined,
      });
      setJustPromotedBanner(true);
    },
    [chunks, updateSettings]
  );

  // 新規チャンク群とセッション・レポートの追加（Live実戦モード等）
  const saveLiveLogResult = useCallback(
    async (params: {
      session: Session;
      report: AiReport;
      newChunks: Chunk[];
    }) => {
      const { session, report, newChunks } = params;
      await saveSessionToDb(session);
      await saveAiReportToDb(report);
      if (newChunks.length > 0) {
        await saveChunksToDb(newChunks);
      }

      setSessions((prev) => [...prev, session]);
      setAiReports((prev) => [...prev, report]);
      if (newChunks.length > 0) {
        setChunks((prev) => [...prev, ...newChunks]);
      }
    },
    []
  );

  // AIコーチ質問メッセージの保存
  const upsertCoachMessage = useCallback(async (msg: CoachMessage) => {
    await saveCoachMessageToDb(msg);
    setCoachMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      if (idx === -1) return [...prev, msg];
      return prev.map((m) => (m.id === msg.id ? msg : m));
    });
  }, []);

  // バックアップのインポート適用
  const applyImportedBackup = useCallback(
    async (bundle: ValidatedBackupBundle) => {
      const mergedSettings = await commitValidatedBackupToDb(
        bundle,
        settings.geminiApiKey
      );
      setSettings(mergedSettings);
      setChunks(bundle.chunks);
      setReviewStates(bundle.reviewStates);
      setAttempts(bundle.attempts);
      setSessions(bundle.sessions);
      setAiReports(bundle.aiReports);
      setCoachMessages(bundle.coachMessages ?? []);
    },
    [settings.geminiApiKey]
  );

  return {
    loading,
    settings,
    chunks,
    reviewStates,
    attempts,
    sessions,
    aiReports,
    coachMessages,
    streakDays,
    suggestRehab,
    justPromotedBanner,
    setJustPromotedBanner,
    updateSettings,
    recordQuestionAttempt,
    completeSessionWithAiReport,
    markChunkUnnatural,
    promoteToLevel,
    saveLiveLogResult,
    upsertCoachMessage,
    applyImportedBackup,
  };
}
