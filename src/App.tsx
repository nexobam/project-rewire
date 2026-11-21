// Project Rewire ルートアプリケーションコンポーネント

import React, { useEffect, useMemo, useState } from 'react';
import { Header, type NavTab } from './components/Header';
import { exportBackupJson } from './db/backup';
import {
  calculatePromotionEta,
  countNewlyMasteredInLast7Days,
  evaluatePromotionGate,
} from './domain/promotionGate';
import { getStudyDate } from './domain/studyDate';
import { useAppStore } from './hooks/useAppStore';
import { useTheme } from './hooks/useTheme';
import { BossBattlePage } from './pages/BossBattlePage';
import { CoachChatPage } from './pages/CoachChatPage';
import { DiagnosisPage } from './pages/DiagnosisPage';
import { HomePage, type ActiveModeLaunch } from './pages/HomePage';
import { LiveModePage } from './pages/LiveModePage';
import { SettingsPage } from './pages/SettingsPage';
import { SilentModePage } from './pages/SilentModePage';
import { SleepModePage } from './pages/SleepModePage';
import { SpeakModePage } from './pages/SpeakModePage';
import { playTactileClick, unlockAudioContext } from './services/audioService';
import { unlockSpeechSynthesis } from './services/ttsService';

export const App: React.FC = () => {
  const {
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
  } = useAppStore();

  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [activeMode, setActiveMode] = useState<ActiveModeLaunch | null>(null);
  const [isRecalibrating, setIsRecalibrating] = useState(false);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState(false);

  const isSleepModeActive = activeMode?.mode === 'sleep';
  const { palette } = useTheme(settings.themePreference, isSleepModeActive);

  const [currentStudyDate, setCurrentStudyDate] = useState(() => getStudyDate());

  // 午前4時境界跨ぎやPWA復帰時の学習日・ストリーク再評価
  useEffect(() => {
    const syncStudyDate = () => {
      const nextDate = getStudyDate();
      setCurrentStudyDate((prev) => {
        if (prev !== nextDate) {
          void refreshStudyDateEvaluation();
        }
        return nextDate;
      });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncStudyDate();
      }
    };
    window.addEventListener('focus', syncStudyDate);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', syncStudyDate);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshStudyDateEvaluation]);

  // セッション実行中フラグをPWA SW更新制御へ共有（セッション終了後に安全リロード）
  useEffect(() => {
    const win = window as unknown as {
      __rewireSessionActive?: boolean;
      __rewirePendingReload?: boolean;
    };
    win.__rewireSessionActive = Boolean(activeMode);
    if (!activeMode && win.__rewirePendingReload) {
      win.__rewirePendingReload = false;
      window.location.reload();
    }
  }, [activeMode]);

  // 昇格ゲートとETAの計算（現レベル昇格後の実績のみを集計）
  const gateStatus = useMemo(
    () =>
      evaluatePromotionGate({
        level: Math.max(1, settings.level) as 1 | 2 | 3 | 4,
        chunks,
        reviewStates,
        attempts,
        levelPromotedAt: settings.levelPromotedAt,
      }),
    [attempts, chunks, reviewStates, settings.level, settings.levelPromotedAt]
  );

  const etaResult = useMemo(() => {
    const activeDatesSet = new Set(
      sessions.filter((s) => s.activeSeconds > 0).map((s) => s.studyDate)
    );
    const coreChunks = chunks.filter(
      (c) => c.level === Math.max(1, settings.level) && c.isCore && !c.disabled
    );
    const newlyMastered7d = countNewlyMasteredInLast7Days({
      coreChunks,
      attempts,
      currentStudyDate,
    });
    const targetCoreCount = Math.ceil(gateStatus.coreTotal * 0.8);
    const remainingCoreChunks = Math.max(
      0,
      targetCoreCount - gateStatus.coreMastered
    );

    return calculatePromotionEta({
      remainingCoreChunks,
      activeStudyDatesCount: activeDatesSet.size,
      newlyMasteredInLast7Days: newlyMastered7d,
    });
  }, [attempts, chunks, currentStudyDate, gateStatus, sessions, settings.level]);

  const handleOneTapBackup = async () => {
    const updated = await updateSettings({ lastBackupAt: Date.now() });
    setJustPromotedBanner(false);
    const jsonStr = await exportBackupJson({
      settings: updated,
      chunks,
      reviewStates,
      attempts,
      sessions,
      aiReports,
      coachMessages,
    });
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project-rewire-backup-${currentStudyDate}.json`;
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 10000);
    }
  };

  const handleStartMode = (launch: ActiveModeLaunch) => {
    // 開始ボタンのタップイベント内で speechSynthesis と AudioContext を初期化する（要件6-1）
    unlockSpeechSynthesis();
    unlockAudioContext();
    playTactileClick(settings.clickSound);
    setActiveMode(launch);
  };

  if (loading) {
    return (
      <div
        style={{
          backgroundColor: palette.background,
          color: palette.text,
        }}
        className="min-h-dvh flex items-center justify-center text-sm font-semibold"
      >
        Project Rewire を起動中...
      </div>
    );
  }

  // Cloudflare D1 クラウド同期モードでパスコード未認証の場合
  if (cloudEnabled && cloudAuthNeeded) {
    return (
      <div
        style={{
          backgroundColor: palette.background,
          color: palette.text,
        }}
        className="min-h-dvh flex items-center justify-center px-4"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setPasscodeError(false);
            const ok = await submitCloudPasscode(passcodeInput);
            if (!ok) {
              setPasscodeError(true);
            }
          }}
          style={{
            backgroundColor: palette.card,
            borderColor: palette.border,
          }}
          className="w-full max-w-sm border rounded-xl p-6 space-y-4"
        >
          <h1 className="text-lg font-bold">Project Rewire ログイン</h1>
          <p className="text-xs opacity-80">
            クラウド同期とサーバー側 Gemini API を利用するため、パスコードを入力してください（一度入力するとこの端末に記憶されます）。
          </p>
          <input
            type="password"
            value={passcodeInput}
            onChange={(e) => setPasscodeInput(e.target.value)}
            placeholder="パスコードを入力..."
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
            }}
            className="w-full px-3 py-2.5 rounded-lg border text-base sm:text-sm"
            autoFocus
          />
          {passcodeError && (
            <p
              style={{ color: palette.crimsonText }}
              className="text-xs font-semibold"
            >
              パスコードが正しくありません。
            </p>
          )}
          <button
            type="submit"
            style={{
              backgroundColor: palette.text,
              color: palette.card,
              borderColor: palette.text,
              borderBottomWidth: '3px',
            }}
            className="w-full min-h-[48px] py-2.5 rounded-lg font-bold text-sm tactile-block"
          >
            ロック解除して同期
          </button>
        </form>
      </div>
    );
  }

  // 初回起動時（level === 0）または設定画面からの perTapMs 再測定時
  if (settings.level === 0 || isRecalibrating) {
    return (
      <div
        style={{
          backgroundColor: palette.background,
          color: palette.text,
        }}
        className="min-h-dvh"
      >
        <Header
          level={settings.level}
          lv1Phase={settings.lv1Phase}
          streakDays={streakDays}
          restTickets={settings.restTickets}
          palette={palette}
          activeTab={activeTab}
          onChangeTab={(tab) => {
            if (isRecalibrating) {
              setIsRecalibrating(false);
              setActiveTab(tab);
            }
          }}
        />
        <DiagnosisPage
          palette={palette}
          ttsRate={settings.ttsRate}
          clickSound={settings.clickSound}
          isRecalibration={isRecalibrating}
          onCompleteDiagnosis={async (measuredPerTapMs) => {
            await updateSettings({
              perTapMs: measuredPerTapMs,
              level: settings.level === 0 ? 1 : settings.level,
            });
            setIsRecalibrating(false);
          }}
          onCancel={
            isRecalibrating ? () => setIsRecalibrating(false) : undefined
          }
        />
      </div>
    );
  }

  const didSilentToday = sessions.some(
    (s) => s.studyDate === currentStudyDate && s.mode === 'silent'
  );

  const viewTransitionKey = activeMode
    ? `mode_${activeMode.mode}_${activeMode.plannedMinutes}`
    : `tab_${activeTab}`;

  return (
    <div
      style={{
        backgroundColor: palette.background,
        color: palette.text,
      }}
      className="min-h-dvh pb-[env(safe-area-inset-bottom)]"
    >
      <Header
        level={settings.level}
        lv1Phase={settings.lv1Phase}
        streakDays={streakDays}
        restTickets={settings.restTickets}
        palette={palette}
        activeTab={activeTab}
        onChangeTab={(tab) => {
          if (activeMode) {
            const msg =
              activeMode.mode === 'boss'
                ? 'ボス戦を中断すると24時間のクールダウンに入ります。移動してよろしいですか？'
                : 'トレーニングを中断して移動しますか？（回答済みの記録は保存されています）';
            if (typeof window !== 'undefined' && !window.confirm(msg)) {
              return;
            }
            if (activeMode.mode === 'boss') {
              void updateSettings({
                bossCooldownUntil: Date.now() + 24 * 60 * 60 * 1000,
              });
            }
            setActiveMode(null);
          }
          setActiveTab(tab);
        }}
      />

      <main key={viewTransitionKey} className="animate-page-enter">
      {activeMode ? (
        activeMode.mode === 'silent' || activeMode.mode === 'rehab' ? (
          <SilentModePage
            plannedMinutes={activeMode.plannedMinutes}
            isRehab={activeMode.mode === 'rehab'}
            isSecondOrLaterToday={didSilentToday}
            settings={settings}
            allChunks={chunks}
            reviewStates={reviewStates}
            recentAttempts={attempts}
            currentStudyDate={currentStudyDate}
            gateStatus={gateStatus}
            palette={palette}
            onRecordAttempt={recordQuestionAttempt}
            onCompleteSession={completeSessionWithAiReport}
            onReportUnnatural={(chunkId) => void markChunkUnnatural(chunkId)}
            onExitHome={() => setActiveMode(null)}
          />
        ) : activeMode.mode === 'speak' ? (
          <SpeakModePage
            plannedMinutes={activeMode.plannedMinutes}
            settings={settings}
            allChunks={chunks}
            reviewStates={reviewStates}
            recentAttempts={attempts}
            currentStudyDate={currentStudyDate}
            gateStatus={gateStatus}
            palette={palette}
            onRecordAttempt={recordQuestionAttempt}
            onCompleteSession={completeSessionWithAiReport}
            onReportUnnatural={(chunkId) => void markChunkUnnatural(chunkId)}
            onExitHome={() => setActiveMode(null)}
          />
        ) : activeMode.mode === 'live' ? (
          <LiveModePage
            settings={settings}
            chunks={chunks}
            attempts={attempts}
            gateStatus={gateStatus}
            currentStudyDate={currentStudyDate}
            palette={palette}
            onSaveLiveResult={saveLiveLogResult}
            onExitHome={() => setActiveMode(null)}
          />
        ) : activeMode.mode === 'sleep' ? (
          <SleepModePage
            allChunks={chunks}
            recentAttempts={attempts}
            currentStudyDate={currentStudyDate}
            ttsRate={settings.ttsRate}
            clickSound={settings.clickSound}
            palette={palette}
            onRecordSleepAttempt={recordQuestionAttempt}
            onCompleteSession={completeSessionWithAiReport}
            onExitHome={() => setActiveMode(null)}
          />
        ) : activeMode.mode === 'boss' ? (
          <BossBattlePage
            settings={settings}
            allChunks={chunks}
            currentStudyDate={currentStudyDate}
            palette={palette}
            onRecordAttempt={recordQuestionAttempt}
            onPassBoss={promoteToLevel}
            onFailBoss={async (cooldownUntil) => {
              await updateSettings({ bossCooldownUntil: cooldownUntil });
            }}
            onExitHome={() => setActiveMode(null)}
          />
        ) : null
      ) : activeTab === 'coach' ? (
        <CoachChatPage
          settings={settings}
          messages={coachMessages}
          palette={palette}
          onUpsertMessage={upsertCoachMessage}
          onDeleteMessage={deleteCoachMessage}
          onClearMessages={clearCoachMessages}
          onRecordApiCall={() => void recordAiApiCall(1)}
          chunks={chunks}
          serverHasGeminiKey={serverHasGeminiKey}
        />
      ) : activeTab === 'settings' ? (
        <SettingsPage
          settings={settings}
          palette={palette}
          onUpdateSettings={updateSettings}
          onStartRecalibration={() => setIsRecalibrating(true)}
        />
      ) : (
        <HomePage
          settings={settings}
          chunks={chunks}
          reviewStates={reviewStates}
          sessions={sessions}
          aiReports={aiReports}
          gateStatus={gateStatus}
          etaText={etaResult.displayText}
          suggestRehab={suggestRehab}
          justPromotedBanner={justPromotedBanner}
          currentStudyDate={currentStudyDate}
          palette={palette}
          cloudEnabled={cloudEnabled}
          onStartMode={handleStartMode}
          onOneTapBackup={() => void handleOneTapBackup()}
          onDismissPromoted={() => setJustPromotedBanner(false)}
          onGenerateAiQuestionsNow={generateAiQuestionsNow}
        />
      )}
      </main>
    </div>
  );
};
export default App;
