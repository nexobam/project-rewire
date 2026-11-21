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
import {
  checkCloudAuthStatus,
  fetchCloudStores,
  pushCloudStores,
  verifyCloudPasscode,
} from '../services/cloudSyncService';
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
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [cloudAuthNeeded, setCloudAuthNeeded] = useState(false);
  const [serverHasGeminiKey, setServerHasGeminiKey] = useState(false);

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

      let mergedData = data;
      const cloudStatus = await checkCloudAuthStatus();
      if (!mounted) return;
      setCloudEnabled(cloudStatus.cloudAvailable);
      setServerHasGeminiKey(cloudStatus.serverHasGeminiKey);

      if (cloudStatus.cloudAvailable) {
        const cloudRes = await fetchCloudStores();
        if (!mounted) return;
        if (cloudRes.unauthorized) {
          setCloudAuthNeeded(true);
        } else if (cloudRes.ok && cloudRes.stores) {
          const cs = cloudRes.stores;
          if (cs.settings || (cs.chunks && cs.chunks.length > 0)) {
            mergedData = {
              settings: cs.settings ?? data.settings,
              chunks:
                cs.chunks && cs.chunks.length > 0 ? cs.chunks : data.chunks,
              reviewStates: cs.reviewStates ?? data.reviewStates,
              attempts: cs.attempts ?? data.attempts,
              sessions: cs.sessions ?? data.sessions,
              aiReports: cs.aiReports ?? data.aiReports,
              coachMessages: cs.coachMessages ?? data.coachMessages,
            };
            await commitValidatedBackupToDb(
              {
                schemaVersion: 1,
                exportedAt: new Date().toISOString(),
                settings: mergedData.settings,
                chunks: mergedData.chunks,
                reviewStates: mergedData.reviewStates,
                attempts: mergedData.attempts,
                sessions: mergedData.sessions,
                aiReports: mergedData.aiReports,
                coachMessages: mergedData.coachMessages,
              },
              data.settings.geminiApiKey
            );
          } else {
            // D1が初回空状態の場合はローカル初期データをD1へ保存
            void pushCloudStores({
              settings: data.settings,
              chunks: data.chunks,
              reviewStates: data.reviewStates,
              attempts: data.attempts,
              sessions: data.sessions,
              aiReports: data.aiReports,
              coachMessages: data.coachMessages,
            });
          }
        }
      }

      const today = getStudyDate();
      const activeDates = mergedData.sessions
        .filter((s) => s.activeSeconds > 0)
        .map((s) => s.studyDate);

      const streakEval = evaluateStreakAndTickets({
        currentStudyDate: today,
        activeStudyDates: activeDates,
        currentTickets: mergedData.settings.restTickets,
        lastTicketRefillWeek: mergedData.settings.lastTicketRefillWeek,
        lastEvaluatedStudyDate: mergedData.settings.lastEvaluatedStudyDate,
      });

      const updatedSettings: Settings = {
        ...mergedData.settings,
        restTickets: streakEval.restTickets,
        lastTicketRefillWeek: streakEval.lastTicketRefillWeek,
        lastEvaluatedStudyDate: streakEval.lastEvaluatedStudyDate,
      };
      await saveSettingsToDb(updatedSettings);

      setSettings(updatedSettings);
      setChunks(mergedData.chunks);
      setReviewStates(mergedData.reviewStates);
      setAttempts(mergedData.attempts);
      setSessions(mergedData.sessions);
      setAiReports(mergedData.aiReports);
      setCoachMessages(mergedData.coachMessages);
      setStreakDays(streakEval.streakDays);
      setSuggestRehab(streakEval.suggestRehab);
      setLoading(false);

      // 起動時に未完了（pending）のAIレポートがあれば再実行
      void processPendingAiReports(
        mergedData.aiReports,
        mergedData.attempts,
        mergedData.chunks,
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
      void pushCloudStores({ settings: next });
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

      let nextReviewStatesList = reviewStates;
      if (nextReviewState) {
        const idx = reviewStates.findIndex(
          (s) => s.chunkId === nextReviewState.chunkId
        );
        nextReviewStatesList =
          idx === -1
            ? [...reviewStates, nextReviewState]
            : reviewStates.map((s, i) => (i === idx ? nextReviewState! : s));
        setReviewStates(nextReviewStatesList);
      }

      const sessIdx = sessions.findIndex((s) => s.id === session.id);
      const nextSessionsList =
        sessIdx === -1
          ? [...sessions, session]
          : sessions.map((s) => (s.id === session.id ? session : s));

      setSessions(() => {
        const activeDates = nextSessionsList
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
        return nextSessionsList;
      });

      void pushCloudStores({
        attempts: nextAttempts,
        reviewStates: nextReviewStatesList,
        sessions: nextSessionsList,
      });

      // Lv.1前半（絵カード期）→後半（語順ブロック期）の自動移行判定
      if (settings.level === 1 && settings.lv1Phase === 'picture') {
        const phaseCheck = checkLv1PhaseTransition(nextAttempts);
        if (phaseCheck.readyForBlocks) {
          await updateSettings({ lv1Phase: 'blocks' });
        }
      }
    },
    [attempts, reviewStates, sessions, settings, updateSettings]
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
      void pushCloudStores({ sessions, aiReports: nextReports });
    },
    [aiReports, attempts, chunks, processPendingAiReports, sessions, settings]
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

  // パスコード認証してD1と同期する
  const submitCloudPasscode = useCallback(
    async (passcode: string): Promise<boolean> => {
      const ok = await verifyCloudPasscode(passcode);
      if (!ok) return false;
      setCloudAuthNeeded(false);

      const cloudRes = await fetchCloudStores();
      if (cloudRes.ok && cloudRes.stores) {
        const cs = cloudRes.stores;
        if (cs.settings || (cs.chunks && cs.chunks.length > 0)) {
          const nextSettings = cs.settings ?? settings;
          const nextChunks =
            cs.chunks && cs.chunks.length > 0 ? cs.chunks : chunks;
          const nextReviews = cs.reviewStates ?? reviewStates;
          const nextAttempts = cs.attempts ?? attempts;
          const nextSessions = cs.sessions ?? sessions;
          const nextReports = cs.aiReports ?? aiReports;
          const nextCoach = cs.coachMessages ?? coachMessages;

          await commitValidatedBackupToDb(
            {
              schemaVersion: 1,
              exportedAt: new Date().toISOString(),
              settings: nextSettings,
              chunks: nextChunks,
              reviewStates: nextReviews,
              attempts: nextAttempts,
              sessions: nextSessions,
              aiReports: nextReports,
              coachMessages: nextCoach,
            },
            settings.geminiApiKey
          );

          setSettings(nextSettings);
          setChunks(nextChunks);
          setReviewStates(nextReviews);
          setAttempts(nextAttempts);
          setSessions(nextSessions);
          setAiReports(nextReports);
          setCoachMessages(nextCoach);

          const activeDates = nextSessions
            .filter((s) => s.activeSeconds > 0)
            .map((s) => s.studyDate);
          const streakEval = evaluateStreakAndTickets({
            currentStudyDate: getStudyDate(),
            activeStudyDates: activeDates,
            currentTickets: nextSettings.restTickets,
            lastTicketRefillWeek: nextSettings.lastTicketRefillWeek,
            lastEvaluatedStudyDate: nextSettings.lastEvaluatedStudyDate,
          });
          setStreakDays(streakEval.streakDays);
          setSuggestRehab(streakEval.suggestRehab);
        } else {
          void pushCloudStores({
            settings,
            chunks,
            reviewStates,
            attempts,
            sessions,
            aiReports,
            coachMessages,
          });
        }
      }
      return true;
    },
    [
      aiReports,
      attempts,
      chunks,
      coachMessages,
      reviewStates,
      sessions,
      settings,
    ]
  );

  return {
    loading,
    cloudEnabled,
    cloudAuthNeeded,
    serverHasGeminiKey,
    submitCloudPasscode,
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
