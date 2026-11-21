// アプリ全体の状態管理・非同期AIレポート再試行・1問ごとの自動保存・安全マージ同期フック

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  commitValidatedBackupToDb,
  type ValidatedBackupBundle,
} from '../db/backup';
import {
  clearCoachMessagesFromDb,
  deleteCoachMessageFromDb,
  initializeAndLoadAppData,
  saveAiReportToDb,
  saveChunksToDb,
  saveCoachMessageToDb,
  saveQuestionProgressTransaction,
  saveSessionToDb,
  saveSettingsToDb,
  setActiveDatabaseProfile,
  upgradeSeedChunksWithLatestExplanations,
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
  type CloudSyncStores,
} from '../services/cloudSyncService';
import {
  normalizeGeminiModelName,
  runFourAiEmployeesPipeline,
} from '../services/geminiService';
import type { UserProfileId } from '../services/profileService';
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

const PENDING_SYNC_KEY = 'rewire_pending_cloud_sync';

function setPendingSyncFlag(pending: boolean): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (pending) {
      window.localStorage.setItem(PENDING_SYNC_KEY, '1');
    } else {
      window.localStorage.removeItem(PENDING_SYNC_KEY);
    }
  } catch {
    // 無視
  }
}

function hasPendingSyncFlag(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    return window.localStorage.getItem(PENDING_SYNC_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * クラウド側とローカル側のストアを安全に和集合マージする（オフライン学習データの消失防止）
 */
export function mergeCloudAndLocalStores(
  local: {
    settings: Settings;
    chunks: Chunk[];
    reviewStates: ReviewState[];
    attempts: Attempt[];
    sessions: Session[];
    aiReports: AiReport[];
    coachMessages: CoachMessage[];
  },
  cloud: CloudSyncStores
) {
  const localSettings: Settings = { ...DEFAULT_SETTINGS, ...local.settings };
  const cloudSettings: Settings | undefined = cloud.settings
    ? { ...DEFAULT_SETTINGS, ...cloud.settings }
    : undefined;

  // Settings マージ：レベル・バックアップ・APIカウント・評価日は進んでいる方を採用し、ローカルのAPIキーは保持
  const mergedSettings: Settings = cloudSettings
    ? {
        ...cloudSettings,
        ...localSettings,
        level: Math.max(localSettings.level, cloudSettings.level) as Level,
        lv1Phase:
          localSettings.lv1Phase === 'blocks' || cloudSettings.lv1Phase === 'blocks'
            ? 'blocks'
            : 'picture',
        geminiApiKey: localSettings.geminiApiKey || cloudSettings.geminiApiKey,
        geminiModel: normalizeGeminiModelName(
          localSettings.geminiModel || cloudSettings.geminiModel
        ),
        lastBackupAt:
          Math.max(localSettings.lastBackupAt ?? 0, cloudSettings.lastBackupAt ?? 0) ||
          undefined,
        levelPromotedAt:
          Math.max(
            localSettings.levelPromotedAt ?? 0,
            cloudSettings.levelPromotedAt ?? 0
          ) || undefined,
        firstUsedAt:
          Math.min(
            localSettings.firstUsedAt ?? Number.MAX_SAFE_INTEGER,
            cloudSettings.firstUsedAt ?? Number.MAX_SAFE_INTEGER
          ) === Number.MAX_SAFE_INTEGER
            ? undefined
            : Math.min(
                localSettings.firstUsedAt ?? Number.MAX_SAFE_INTEGER,
                cloudSettings.firstUsedAt ?? Number.MAX_SAFE_INTEGER
              ),
      }
    : localSettings;

  // Chunks マージ：disabled: true と isCore: true は安全側に優先
  const chunkMap = new Map<string, Chunk>();
  for (const c of cloud.chunks ?? []) {
    chunkMap.set(c.id, c);
  }
  for (const c of local.chunks) {
    const prev = chunkMap.get(c.id);
    if (!prev) {
      chunkMap.set(c.id, c);
    } else {
      chunkMap.set(c.id, {
        ...prev,
        ...c,
        disabled: prev.disabled || c.disabled,
        isCore: prev.isCore || c.isCore,
      });
    }
  }
  const upgraded = upgradeSeedChunksWithLatestExplanations([...chunkMap.values()]);
  const mergedChunks = upgraded.chunks;

  // ReviewStates マージ：より学習履歴が進んでいる方を優先
  const reviewMap = new Map<string, ReviewState>();
  for (const rs of cloud.reviewStates ?? []) {
    reviewMap.set(rs.chunkId, rs);
  }
  for (const rs of local.reviewStates) {
    const prev = reviewMap.get(rs.chunkId);
    if (
      !prev ||
      rs.recentRatings.length > prev.recentRatings.length ||
      (rs.recentRatings.length === prev.recentRatings.length &&
        rs.stage >= prev.stage)
    ) {
      reviewMap.set(rs.chunkId, rs);
    }
  }

  // Attempts マージ：ID和集合
  const attemptMap = new Map<string, Attempt>();
  for (const a of cloud.attempts ?? []) attemptMap.set(a.id, a);
  for (const a of local.attempts) attemptMap.set(a.id, a);

  // Sessions マージ：endedAt がある方や activeSeconds が大きい方を優先
  const sessionMap = new Map<string, Session>();
  for (const s of cloud.sessions ?? []) sessionMap.set(s.id, s);
  for (const s of local.sessions) {
    const prev = sessionMap.get(s.id);
    if (!prev) {
      sessionMap.set(s.id, s);
    } else {
      sessionMap.set(s.id, {
        ...prev,
        ...s,
        activeSeconds: Math.max(prev.activeSeconds, s.activeSeconds),
        endedAt: s.endedAt ?? prev.endedAt,
      });
    }
  }

  // AiReports マージ：done を優先
  const reportMap = new Map<string, AiReport>();
  for (const r of cloud.aiReports ?? []) reportMap.set(r.id, r);
  for (const r of local.aiReports) {
    const prev = reportMap.get(r.id);
    if (!prev || (prev.status !== 'done' && r.status === 'done')) {
      reportMap.set(r.id, r);
    }
  }

  // CoachMessages マージ：answered を優先
  const coachMap = new Map<string, CoachMessage>();
  for (const m of cloud.coachMessages ?? []) coachMap.set(m.id, m);
  for (const m of local.coachMessages) {
    const prev = coachMap.get(m.id);
    if (!prev || (prev.status !== 'answered' && m.status === 'answered')) {
      coachMap.set(m.id, m);
    }
  }

  const hasLocalOnlyChanges =
    local.attempts.length > (cloud.attempts?.length ?? 0) ||
    local.sessions.length > (cloud.sessions?.length ?? 0) ||
    local.chunks.length > (cloud.chunks?.length ?? 0) ||
    local.coachMessages.length > (cloud.coachMessages?.length ?? 0) ||
    hasPendingSyncFlag() ||
    upgraded.changed;

  return {
    merged: {
      settings: mergedSettings,
      chunks: mergedChunks,
      reviewStates: [...reviewMap.values()],
      attempts: [...attemptMap.values()].sort((a, b) => a.startedAt - b.startedAt),
      sessions: [...sessionMap.values()].sort((a, b) => a.startedAt - b.startedAt),
      aiReports: [...reportMap.values()].sort((a, b) => a.createdAt - b.createdAt),
      coachMessages: [...coachMap.values()].sort((a, b) => a.createdAt - b.createdAt),
    },
    hasLocalOnlyChanges,
  };
}

export function useAppStore(activeProfile: UserProfileId | null = null) {
  const [loading, setLoading] = useState(Boolean(activeProfile));
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

  // 最新状態を参照するための Ref ミラー（Stale Closure による状態巻き戻り・消失を根絶）
  const settingsRef = useRef<Settings>(settings);
  const chunksRef = useRef<Chunk[]>(chunks);
  const reviewStatesRef = useRef<ReviewState[]>(reviewStates);
  const attemptsRef = useRef<Attempt[]>(attempts);
  const sessionsRef = useRef<Session[]>(sessions);
  const aiReportsRef = useRef<AiReport[]>(aiReports);
  const coachMessagesRef = useRef<CoachMessage[]>(coachMessages);
  const processingReportIdsRef = useRef<Set<string>>(new Set());

  const syncPushWithRetryFlag = useCallback(
    async (stores: CloudSyncStores) => {
      const ok = await pushCloudStores(stores, activeProfile);
      if (!ok) {
        setPendingSyncFlag(true);
      } else if (
        stores.settings &&
        stores.chunks &&
        stores.attempts &&
        stores.sessions
      ) {
        setPendingSyncFlag(false);
      }
      return ok;
    },
    [activeProfile]
  );

  const applyAllStoresState = useCallback(
    (next: {
      settings: Settings;
      chunks: Chunk[];
      reviewStates: ReviewState[];
      attempts: Attempt[];
      sessions: Session[];
      aiReports: AiReport[];
      coachMessages: CoachMessage[];
    }) => {
      settingsRef.current = next.settings;
      chunksRef.current = next.chunks;
      reviewStatesRef.current = next.reviewStates;
      attemptsRef.current = next.attempts;
      sessionsRef.current = next.sessions;
      aiReportsRef.current = next.aiReports;
      coachMessagesRef.current = next.coachMessages;

      setSettings(next.settings);
      setChunks(next.chunks);
      setReviewStates(next.reviewStates);
      setAttempts(next.attempts);
      setSessions(next.sessions);
      setAiReports(next.aiReports);
      setCoachMessages(next.coachMessages);
    },
    []
  );

  // pending状態のAIレポートを非同期に処理する（排他ロック＋最新Refマージで巻き戻り防止）
  const processPendingAiReports = useCallback(
    async (targetReports?: AiReport[]) => {
      const pendings = (targetReports ?? aiReportsRef.current).filter(
        (r) => r.status === 'pending'
      );
      if (pendings.length === 0) return;

      for (const report of pendings) {
        if (processingReportIdsRef.current.has(report.id)) {
          continue;
        }
        processingReportIdsRef.current.add(report.id);

        try {
          if (report.retryCount >= 3) {
            const failedReport: AiReport = { ...report, status: 'failed' };
            await saveAiReportToDb(failedReport);
            const nextList = aiReportsRef.current.map((r) =>
              r.id === failedReport.id ? failedReport : r
            );
            aiReportsRef.current = nextList;
            setAiReports(nextList);
            continue;
          }

          const sessionAttempts = attemptsRef.current.filter(
            (a) => a.sessionId === report.sessionId
          );

          const result = await runFourAiEmployeesPipeline({
            sessionAttempts,
            existingChunks: chunksRef.current,
            settings: settingsRef.current,
          });

          const today = getStudyDate();
          if (result.apiCallsMade > 0) {
            const latestSettings = settingsRef.current;
            const prevCount =
              latestSettings.apiCallDate === today
                ? (latestSettings.apiCallCount ?? 0)
                : 0;
            const patchedSettings: Settings = {
              ...latestSettings,
              apiCallDate: today,
              apiCallCount: prevCount + result.apiCallsMade,
            };
            settingsRef.current = patchedSettings;
            setSettings(patchedSettings);
            await saveSettingsToDb(patchedSettings);
          }

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
            const nextList = aiReportsRef.current.map((r) =>
              r.id === updated.id ? updated : r
            );
            aiReportsRef.current = nextList;
            setAiReports(nextList);
            continue;
          }

          if (result.newChunks.length > 0) {
            const existingIds = new Set(chunksRef.current.map((c) => c.id));
            const existingEn = new Set(
              chunksRef.current.map((c) => c.enText.trim().toLowerCase())
            );
            const uniqueNew = result.newChunks.filter(
              (c) =>
                !existingIds.has(c.id) &&
                !existingEn.has(c.enText.trim().toLowerCase())
            );
            if (uniqueNew.length > 0) {
              await saveChunksToDb(uniqueNew);
              const nextChunks = [...chunksRef.current, ...uniqueNew];
              chunksRef.current = nextChunks;
              setChunks(nextChunks);
            }
          }

          const doneReport: AiReport = {
            ...report,
            status: 'done',
            analyst: result.analyst,
            teacher: result.teacher,
          };
          await saveAiReportToDb(doneReport);
          const nextReports = aiReportsRef.current.map((r) =>
            r.id === doneReport.id ? doneReport : r
          );
          aiReportsRef.current = nextReports;
          setAiReports(nextReports);

          void syncPushWithRetryFlag({
            chunks: chunksRef.current,
            aiReports: nextReports,
            settings: settingsRef.current,
          });
        } finally {
          processingReportIdsRef.current.delete(report.id);
        }
      }
    },
    [syncPushWithRetryFlag]
  );

  // ストリークとチケットの再評価（午前4時跨ぎや日付変更時にも安全に呼び出し可能）
  const refreshStudyDateEvaluation = useCallback(
    async (baseSettings?: Settings, baseSessions?: Session[]) => {
      const targetSettings = baseSettings ?? settingsRef.current;
      const targetSessions = baseSessions ?? sessionsRef.current;
      const today = getStudyDate();
      const activeDates = targetSessions
        .filter((s) => s.activeSeconds > 0)
        .map((s) => s.studyDate);

      const streakEval = evaluateStreakAndTickets({
        currentStudyDate: today,
        activeStudyDates: activeDates,
        currentTickets: targetSettings.restTickets,
        lastTicketRefillWeek: targetSettings.lastTicketRefillWeek,
        lastEvaluatedStudyDate: targetSettings.lastEvaluatedStudyDate,
      });

      setStreakDays(streakEval.streakDays);
      setSuggestRehab(streakEval.suggestRehab);

      if (
        targetSettings.restTickets !== streakEval.restTickets ||
        targetSettings.lastTicketRefillWeek !== streakEval.lastTicketRefillWeek ||
        targetSettings.lastEvaluatedStudyDate !== streakEval.lastEvaluatedStudyDate
      ) {
        const nextSettings: Settings = {
          ...targetSettings,
          restTickets: streakEval.restTickets,
          lastTicketRefillWeek: streakEval.lastTicketRefillWeek,
          lastEvaluatedStudyDate: streakEval.lastEvaluatedStudyDate,
        };
        settingsRef.current = nextSettings;
        setSettings(nextSettings);
        await saveSettingsToDb(nextSettings);
        void syncPushWithRetryFlag({ settings: nextSettings });
      }
    },
    [syncPushWithRetryFlag]
  );

  // 初回ロード（プロファイル選択後に該当ユーザー専用DB＆クラウド領域を読み込み）
  useEffect(() => {
    if (!activeProfile) {
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    setActiveDatabaseProfile(activeProfile);

    void (async () => {
      try {
        const data = await initializeAndLoadAppData();
        if (!mounted) return;

        const normalizedSettings: Settings = {
          ...DEFAULT_SETTINGS,
          ...data.settings,
          geminiModel: normalizeGeminiModelName(data.settings.geminiModel),
        };
        const localBundle = { ...data, settings: normalizedSettings };
        applyAllStoresState(localBundle);

        const today = getStudyDate();
        const activeDates = localBundle.sessions
          .filter((s) => s.activeSeconds > 0)
          .map((s) => s.studyDate);
        const initialEval = evaluateStreakAndTickets({
          currentStudyDate: today,
          activeStudyDates: activeDates,
          currentTickets: normalizedSettings.restTickets,
          lastTicketRefillWeek: normalizedSettings.lastTicketRefillWeek,
          lastEvaluatedStudyDate: normalizedSettings.lastEvaluatedStudyDate,
        });
        setStreakDays(initialEval.streakDays);
        setSuggestRehab(initialEval.suggestRehab);
        setLoading(false);

        const cloudStatus = await checkCloudAuthStatus();
        if (!mounted) return;
        setCloudEnabled(cloudStatus.cloudAvailable);
        setServerHasGeminiKey(cloudStatus.serverHasGeminiKey);

        if (cloudStatus.cloudAvailable) {
          const cloudRes = await fetchCloudStores(activeProfile);
          if (!mounted) return;
          if (cloudRes.unauthorized) {
            setCloudAuthNeeded(true);
            return;
          }
          if (cloudRes.ok && cloudRes.stores) {
            const cs = cloudRes.stores;
            if (cs.settings || (cs.chunks && cs.chunks.length > 0)) {
              const { merged, hasLocalOnlyChanges } = mergeCloudAndLocalStores(
                {
                  settings: settingsRef.current,
                  chunks: chunksRef.current,
                  reviewStates: reviewStatesRef.current,
                  attempts: attemptsRef.current,
                  sessions: sessionsRef.current,
                  aiReports: aiReportsRef.current,
                  coachMessages: coachMessagesRef.current,
                },
                cs
              );

              await commitValidatedBackupToDb(
                {
                  schemaVersion: 1,
                  exportedAt: new Date().toISOString(),
                  settings: merged.settings,
                  chunks: merged.chunks,
                  reviewStates: merged.reviewStates,
                  attempts: merged.attempts,
                  sessions: merged.sessions,
                  aiReports: merged.aiReports,
                  coachMessages: merged.coachMessages,
                },
                settingsRef.current.geminiApiKey
              );
              if (!mounted) return;
              applyAllStoresState(merged);
              await refreshStudyDateEvaluation(merged.settings, merged.sessions);

              if (hasLocalOnlyChanges) {
                await syncPushWithRetryFlag(merged);
              }
            } else {
              // D1が空ならローカルを全送信
              await syncPushWithRetryFlag({
                settings: settingsRef.current,
                chunks: chunksRef.current,
                reviewStates: reviewStatesRef.current,
                attempts: attemptsRef.current,
                sessions: sessionsRef.current,
                aiReports: aiReportsRef.current,
                coachMessages: coachMessagesRef.current,
              });
            }
          }
        }

        if (!mounted) return;
        await refreshStudyDateEvaluation(settingsRef.current, sessionsRef.current);
        void processPendingAiReports(aiReportsRef.current);
      } catch (err) {
        console.error('Initialization failed:', err);
        if (mounted) {
          setLoading(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [activeProfile, applyAllStoresState, processPendingAiReports, refreshStudyDateEvaluation, syncPushWithRetryFlag]);

  // オンライン復帰時に未同期データがあれば再送信
  useEffect(() => {
    const handleOnline = () => {
      if (hasPendingSyncFlag() && cloudEnabled && !cloudAuthNeeded) {
        void syncPushWithRetryFlag({
          settings: settingsRef.current,
          chunks: chunksRef.current,
          reviewStates: reviewStatesRef.current,
          attempts: attemptsRef.current,
          sessions: sessionsRef.current,
          aiReports: aiReportsRef.current,
          coachMessages: coachMessagesRef.current,
        });
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [cloudAuthNeeded, cloudEnabled, syncPushWithRetryFlag]);

  // 設定の更新
  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next: Settings = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettings(next);
      await saveSettingsToDb(next);
      void syncPushWithRetryFlag({ settings: next });
      return next;
    },
    [syncPushWithRetryFlag]
  );

  // AI質問チャット等でのAPI呼び出し回数記録
  const recordAiApiCall = useCallback(
    async (calls: number = 1) => {
      const today = getStudyDate();
      const latest = settingsRef.current;
      const prevCount =
        latest.apiCallDate === today ? (latest.apiCallCount ?? 0) : 0;
      return updateSettings({
        apiCallDate: today,
        apiCallCount: prevCount + calls,
      });
    },
    [updateSettings]
  );

  // 1問ごとの自動保存（Attempt + ReviewState + Session.activeSeconds を1トランザクションで保存）
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
          reviewStatesRef.current.find((s) => s.chunkId === attempt.chunkId) ??
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

      const nextAttempts = [...attemptsRef.current, attempt];
      attemptsRef.current = nextAttempts;
      setAttempts(nextAttempts);

      let nextReviewStatesList = reviewStatesRef.current;
      if (nextReviewState) {
        const idx = nextReviewStatesList.findIndex(
          (s) => s.chunkId === nextReviewState.chunkId
        );
        nextReviewStatesList =
          idx === -1
            ? [...nextReviewStatesList, nextReviewState]
            : nextReviewStatesList.map((s, i) =>
                i === idx ? nextReviewState! : s
              );
        reviewStatesRef.current = nextReviewStatesList;
        setReviewStates(nextReviewStatesList);
      }

      const currSessions = sessionsRef.current;
      const sessIdx = currSessions.findIndex((s) => s.id === session.id);
      const nextSessionsList =
        sessIdx === -1
          ? [...currSessions, session]
          : currSessions.map((s) => (s.id === session.id ? session : s));
      sessionsRef.current = nextSessionsList;
      setSessions(nextSessionsList);

      const latestSettings = settingsRef.current;
      const activeDates = nextSessionsList
        .filter((s) => s.activeSeconds > 0)
        .map((s) => s.studyDate);
      const streakEval = evaluateStreakAndTickets({
        currentStudyDate: getStudyDate(),
        activeStudyDates: activeDates,
        currentTickets: latestSettings.restTickets,
        lastTicketRefillWeek: latestSettings.lastTicketRefillWeek,
        lastEvaluatedStudyDate: latestSettings.lastEvaluatedStudyDate,
      });
      setStreakDays(streakEval.streakDays);
      setSuggestRehab(false);

      void syncPushWithRetryFlag({
        attempts: nextAttempts,
        reviewStates: nextReviewStatesList,
        sessions: nextSessionsList,
      });

      if (
        settingsRef.current.level === 1 &&
        settingsRef.current.lv1Phase === 'picture'
      ) {
        const phaseCheck = checkLv1PhaseTransition(nextAttempts);
        if (phaseCheck.readyForBlocks) {
          await updateSettings({ lv1Phase: 'blocks' });
        }
      }
    },
    [syncPushWithRetryFlag, updateSettings]
  );

  // セッション終了と非同期AIレポート登録・実行（skipAiGeneration=true のときは問題生成をスキップ）
  const completeSessionWithAiReport = useCallback(
    async (
      finishedSession: Session,
      options?: { skipAiGeneration?: boolean }
    ) => {
      await saveSessionToDb(finishedSession);
      const currSessions = sessionsRef.current;
      const idx = currSessions.findIndex((s) => s.id === finishedSession.id);
      const nextSessions =
        idx === -1
          ? [...currSessions, finishedSession]
          : currSessions.map((s) =>
              s.id === finishedSession.id ? finishedSession : s
            );
      sessionsRef.current = nextSessions;
      setSessions(nextSessions);

      if (
        options?.skipAiGeneration ||
        finishedSession.mode === 'sleep' ||
        finishedSession.activeSeconds <= 0
      ) {
        void syncPushWithRetryFlag({ sessions: nextSessions });
        return;
      }

      const pendingReport: AiReport = {
        id: `report_${finishedSession.id}`,
        sessionId: finishedSession.id,
        studyDate: finishedSession.studyDate,
        status: 'pending',
        retryCount: 0,
        createdAt: Date.now(),
      };
      await saveAiReportToDb(pendingReport);
      const nextReports = [...aiReportsRef.current, pendingReport];
      aiReportsRef.current = nextReports;
      setAiReports(nextReports);

      void syncPushWithRetryFlag({
        sessions: nextSessions,
        aiReports: nextReports,
      });
      void processPendingAiReports([pendingReport]);
    },
    [processPendingAiReports, syncPushWithRetryFlag]
  );

  // 「不自然」報告ボタンによる問題の無効化（disabled = true）
  const markChunkUnnatural = useCallback(
    async (chunkId: string) => {
      const target = chunksRef.current.find((c) => c.id === chunkId);
      if (!target) return;
      const updated: Chunk = { ...target, disabled: true };
      await saveChunksToDb([updated]);
      const nextChunks = chunksRef.current.map((c) =>
        c.id === chunkId ? updated : c
      );
      chunksRef.current = nextChunks;
      setChunks(nextChunks);
      void syncPushWithRetryFlag({ chunks: nextChunks });
    },
    [syncPushWithRetryFlag]
  );

  // ボス戦合格によるレベル昇格（Lv.2〜4のコアセット40チャンクを固定＋昇格日時記録）
  const promoteToLevel = useCallback(
    async (nextLevel: Level) => {
      const lockedChunks = lockCoreSetForLevel(nextLevel, chunksRef.current);
      await saveChunksToDb(lockedChunks);
      chunksRef.current = lockedChunks;
      setChunks(lockedChunks);
      await updateSettings({
        level: nextLevel,
        bossCooldownUntil: undefined,
        levelPromotedAt: Date.now(),
      });
      void syncPushWithRetryFlag({ chunks: lockedChunks });
      setJustPromotedBanner(true);
    },
    [syncPushWithRetryFlag, updateSettings]
  );

  // 新規チャンク群とセッション・レポートの追加（Live実戦モード等）
  const saveLiveLogResult = useCallback(
    async (params: {
      session: Session;
      report: AiReport;
      newChunks: Chunk[];
    }) => {
      const { session, report, newChunks } = params;
      const existingEn = new Set(
        chunksRef.current.map((c) => c.enText.trim().toLowerCase())
      );
      const uniqueNewChunks = newChunks.filter(
        (c) => !existingEn.has(c.enText.trim().toLowerCase())
      );

      await saveSessionToDb(session);
      await saveAiReportToDb(report);
      if (uniqueNewChunks.length > 0) {
        await saveChunksToDb(uniqueNewChunks);
      }

      const nextSessions = [...sessionsRef.current, session];
      const nextReports = [...aiReportsRef.current, report];
      const nextChunks =
        uniqueNewChunks.length > 0
          ? [...chunksRef.current, ...uniqueNewChunks]
          : chunksRef.current;

      sessionsRef.current = nextSessions;
      aiReportsRef.current = nextReports;
      chunksRef.current = nextChunks;

      setSessions(nextSessions);
      setAiReports(nextReports);
      if (uniqueNewChunks.length > 0) {
        setChunks(nextChunks);
      }

      await refreshStudyDateEvaluation(settingsRef.current, nextSessions);

      void syncPushWithRetryFlag({
        sessions: nextSessions,
        aiReports: nextReports,
        chunks: nextChunks,
      });
    },
    [refreshStudyDateEvaluation, syncPushWithRetryFlag]
  );

  // バックアップのインポート適用
  const applyImportedBackup = useCallback(
    async (bundle: ValidatedBackupBundle) => {
      const mergedSettings = await commitValidatedBackupToDb(
        bundle,
        settingsRef.current.geminiApiKey
      );
      const nextData = {
        settings: { ...DEFAULT_SETTINGS, ...mergedSettings },
        chunks: bundle.chunks,
        reviewStates: bundle.reviewStates,
        attempts: bundle.attempts,
        sessions: bundle.sessions,
        aiReports: bundle.aiReports,
        coachMessages: bundle.coachMessages ?? [],
      };
      applyAllStoresState(nextData);
      await refreshStudyDateEvaluation(nextData.settings, nextData.sessions);
      void syncPushWithRetryFlag(nextData);
    },
    [applyAllStoresState, refreshStudyDateEvaluation, syncPushWithRetryFlag]
  );

  // AIコーチ質問メッセージの保存
  const upsertCoachMessage = useCallback(
    async (msg: CoachMessage) => {
      await saveCoachMessageToDb(msg);
      const curr = coachMessagesRef.current;
      const idx = curr.findIndex((m) => m.id === msg.id);
      const nextList =
        idx === -1 ? [...curr, msg] : curr.map((m) => (m.id === msg.id ? msg : m));
      coachMessagesRef.current = nextList;
      setCoachMessages(nextList);
      void syncPushWithRetryFlag({ coachMessages: nextList });
    },
    [syncPushWithRetryFlag]
  );

  // AI講師質問メッセージの1件削除
  const deleteCoachMessage = useCallback(
    async (id: string) => {
      await deleteCoachMessageFromDb(id);
      const nextList = coachMessagesRef.current.filter((m) => m.id !== id);
      coachMessagesRef.current = nextList;
      setCoachMessages(nextList);
      void syncPushWithRetryFlag({ coachMessages: nextList });
    },
    [syncPushWithRetryFlag]
  );

  // AI講師質問履歴の全削除
  const clearCoachMessages = useCallback(async () => {
    await clearCoachMessagesFromDb();
    coachMessagesRef.current = [];
    setCoachMessages([]);
    void syncPushWithRetryFlag({ coachMessages: [] });
  }, [syncPushWithRetryFlag]);

  // 手動で今すぐAI社員に新問題を5問生成させるアクション
  const generateAiQuestionsNow = useCallback(async (): Promise<{
    addedCount: number;
    usedMock: boolean;
  }> => {
    const result = await runFourAiEmployeesPipeline({
      sessionAttempts: attemptsRef.current.slice(-15),
      existingChunks: chunksRef.current,
      settings: settingsRef.current,
    });

    const today = getStudyDate();
    if (result.apiCallsMade > 0) {
      const latestSettings = settingsRef.current;
      const prevCount =
        latestSettings.apiCallDate === today
          ? (latestSettings.apiCallCount ?? 0)
          : 0;
      const nextSettings: Settings = {
        ...latestSettings,
        apiCallDate: today,
        apiCallCount: prevCount + result.apiCallsMade,
      };
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      await saveSettingsToDb(nextSettings);
    }

    let addedCount = 0;
    if (result.newChunks.length > 0) {
      const existingIds = new Set(chunksRef.current.map((c) => c.id));
      const existingEn = new Set(
        chunksRef.current.map((c) => c.enText.trim().toLowerCase())
      );
      const uniqueNew = result.newChunks.filter(
        (c) =>
          !existingIds.has(c.id) &&
          !existingEn.has(c.enText.trim().toLowerCase())
      );
      if (uniqueNew.length > 0) {
        await saveChunksToDb(uniqueNew);
        const nextChunks = [...chunksRef.current, ...uniqueNew];
        chunksRef.current = nextChunks;
        setChunks(nextChunks);
        addedCount = uniqueNew.length;
      }
    }

    const manualReport: AiReport = {
      id: `report_manual_${Date.now()}`,
      sessionId: 'manual_generation',
      studyDate: today,
      status: 'done',
      retryCount: 0,
      analyst: result.analyst,
      teacher: result.teacher,
      createdAt: Date.now(),
    };
    await saveAiReportToDb(manualReport);
    const nextReports = [...aiReportsRef.current, manualReport];
    aiReportsRef.current = nextReports;
    setAiReports(nextReports);

    void syncPushWithRetryFlag({
      chunks: chunksRef.current,
      aiReports: nextReports,
      settings: settingsRef.current,
    });

    return { addedCount, usedMock: result.usedMock };
  }, [syncPushWithRetryFlag]);

  // パスコード認証してD1と安全マージ同期する
  const submitCloudPasscode = useCallback(
    async (passcode: string): Promise<boolean> => {
      const ok = await verifyCloudPasscode(passcode);
      if (!ok) return false;
      setCloudAuthNeeded(false);

      const cloudRes = await fetchCloudStores(activeProfile);
      if (cloudRes.ok && cloudRes.stores) {
        const cs = cloudRes.stores;
        if (cs.settings || (cs.chunks && cs.chunks.length > 0)) {
          const { merged, hasLocalOnlyChanges } = mergeCloudAndLocalStores(
            {
              settings: settingsRef.current,
              chunks: chunksRef.current,
              reviewStates: reviewStatesRef.current,
              attempts: attemptsRef.current,
              sessions: sessionsRef.current,
              aiReports: aiReportsRef.current,
              coachMessages: coachMessagesRef.current,
            },
            cs
          );

          await commitValidatedBackupToDb(
            {
              schemaVersion: 1,
              exportedAt: new Date().toISOString(),
              settings: merged.settings,
              chunks: merged.chunks,
              reviewStates: merged.reviewStates,
              attempts: merged.attempts,
              sessions: merged.sessions,
              aiReports: merged.aiReports,
              coachMessages: merged.coachMessages,
            },
            settingsRef.current.geminiApiKey
          );

          applyAllStoresState(merged);
          await refreshStudyDateEvaluation(merged.settings, merged.sessions);
          if (hasLocalOnlyChanges) {
            await syncPushWithRetryFlag(merged);
          }
        } else {
          await syncPushWithRetryFlag({
            settings: settingsRef.current,
            chunks: chunksRef.current,
            reviewStates: reviewStatesRef.current,
            attempts: attemptsRef.current,
            sessions: sessionsRef.current,
            aiReports: aiReportsRef.current,
            coachMessages: coachMessagesRef.current,
          });
        }
      }
      return true;
    },
    [activeProfile, applyAllStoresState, refreshStudyDateEvaluation, syncPushWithRetryFlag]
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
    recordAiApiCall,
    refreshStudyDateEvaluation,
    recordQuestionAttempt,
    completeSessionWithAiReport,
    markChunkUnnatural,
    promoteToLevel,
    saveLiveLogResult,
    upsertCoachMessage,
    deleteCoachMessage,
    clearCoachMessages,
    generateAiQuestionsNow,
    applyImportedBackup,
  };
}
