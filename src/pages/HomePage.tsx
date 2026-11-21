// ホーム画面（親指1タップ開始「迷ったらこれ」・リハビリ提案・5モード選択・PC 2カラム対応・要件4, 6, 7）

import React from 'react';
import {
  Activity,
  ChevronRight,
  Headphones,
  Mic,
  Moon,
  Play,
  Radio,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { BackupBanner } from '../components/BackupBanner';
import { HeatmapCalendar } from '../components/HeatmapCalendar';
import { PromotionProgress } from '../components/PromotionProgress';
import { ScrollReveal } from '../components/ScrollReveal';
import type { ThemePalette } from '../domain/contrast';
import type { GateStatus } from '../domain/promotionGate';
import { isReviewDue } from '../domain/srs';
import { speakEnglishText } from '../services/ttsService';
import type {
  AiReport,
  Chunk,
  ReviewState,
  Session,
  SessionMode,
  Settings,
} from '../types';

export interface ActiveModeLaunch {
  mode: SessionMode;
  plannedMinutes: number;
}

export interface HomePageProps {
  settings: Settings;
  chunks: Chunk[];
  reviewStates: ReviewState[];
  sessions: Session[];
  aiReports: AiReport[];
  gateStatus: GateStatus;
  etaText: string;
  suggestRehab: boolean;
  justPromotedBanner: boolean;
  currentStudyDate: string;
  palette: ThemePalette;
  cloudEnabled?: boolean;
  onStartMode: (launch: ActiveModeLaunch) => void;
  onOneTapBackup: () => void;
  onDismissPromoted: () => void;
  onGenerateAiQuestionsNow?: () => Promise<{
    addedCount: number;
    usedMock: boolean;
  }>;
}

/**
 * SRSの期限、時間帯、その日の実績から「迷ったらこれ（1タップ開始）」のおすすめモードをプログラムで決定する（要件7）
 */
export function selectRecommendedAction(params: {
  suggestRehab: boolean;
  dueReviewCount: number;
  todaySessions: Session[];
  currentHour: number;
}): {
  label: string;
  reason: string;
  launch: ActiveModeLaunch;
} {
  const { suggestRehab, dueReviewCount, todaySessions, currentHour } = params;

  if (suggestRehab) {
    return {
      label: '3分リハビリメニューを開始',
      reason: '2日以上空いたため、まずは軽い3分間のウォームアップで英語回路を再点火します。',
      launch: { mode: 'rehab', plannedMinutes: 3 },
    };
  }

  // 夜間（22時〜翌3時）でその日すでに学習済みの場合はスリープ・プライミングを提案
  if ((currentHour >= 22 || currentHour <= 3) && todaySessions.length > 0) {
    return {
      label: 'スリープ・プライミング（3分）を開始',
      reason: '就寝前の時間帯です。今日苦戦した3チャンクを音声だけで聴いて記憶を定着させましょう。',
      launch: { mode: 'sleep', plannedMinutes: 3 },
    };
  }

  // 今日すでにサイレントモードを実施済みで、発話ドリルがまだなら発話ドリルを提案
  const didSilentToday = todaySessions.some((s) => s.mode === 'silent');
  const didSpeakToday = todaySessions.some((s) => s.mode === 'speak');
  if (didSilentToday && !didSpeakToday) {
    return {
      label: '発話ドリル（5分）を開始',
      reason: '今日のサイレント学習をクリア済みです。状況カードから瞬時に声に出すブリッジ訓練へ進みましょう。',
      launch: { mode: 'speak', plannedMinutes: 5 },
    };
  }

  // 期限到来の復習が多い場合はサイレント15分、そうでなければ標準15分
  if (dueReviewCount >= 5) {
    return {
      label: `サイレントモード（15分）を開始（今日の復習 ${dueReviewCount}件）`,
      reason: '復習のタイミングが来たフレーズがあります。音と語順で瞬発力をキープしましょう。',
      launch: { mode: 'silent', plannedMinutes: 15 },
    };
  }

  return {
    label: 'サイレントモード（15分）を開始',
    reason: '音と語順ブロックの標準15分トレーニングで英語の瞬発力を鍛えます。',
    launch: { mode: 'silent', plannedMinutes: 15 },
  };
}

export const HomePage: React.FC<HomePageProps> = ({
  settings,
  chunks,
  reviewStates,
  sessions,
  aiReports,
  gateStatus,
  etaText,
  suggestRehab,
  justPromotedBanner,
  currentStudyDate,
  palette,
  cloudEnabled = false,
  onStartMode,
  onOneTapBackup,
  onDismissPromoted,
  onGenerateAiQuestionsNow,
}) => {
  const [generatingAi, setGeneratingAi] = React.useState(false);
  const [aiGenNotice, setAiGenNotice] = React.useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = React.useState<
    'gate' | 'calendar' | 'library'
  >('gate');
  const [tickerIndex, setTickerIndex] = React.useState(0);

  const livePhrases = React.useMemo(
    () => [
      { en: "Let's do this!", ja: '今日も自分のペースで頑張ろう！' },
      { en: 'Keep going!', ja: '毎日の積み重ねが必ず力になる' },
      { en: 'You got this!', ja: '1日5分でも確実に英語に近づいてる' },
      { en: 'Step by step!', ja: '焦らず楽しくトレーニングしよう' },
    ],
    []
  );

  React.useEffect(() => {
    const timer = setInterval(() => {
      setTickerIndex((prev) => (prev + 1) % livePhrases.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [livePhrases.length]);

  const currentLivePhrase = livePhrases[tickerIndex];

  const activeChunks = chunks.filter((c) => !c.disabled);
  const seedCount = activeChunks.filter((c) => c.source === 'seed').length;
  const aiCount = activeChunks.filter((c) => c.source === 'ai').length;
  const liveOrRecompCount = activeChunks.filter(
    (c) => c.source === 'live' || c.source === 'recomposed'
  ).length;
  const dueCount = reviewStates.filter((s) =>
    isReviewDue(s, currentStudyDate)
  ).length;
  const todaySessions = sessions.filter(
    (s) => s.studyDate === currentStudyDate
  );
  const currentHour = new Date().getHours();

  const recommendation = selectRecommendedAction({
    suggestRehab,
    dueReviewCount: dueCount,
    todaySessions,
    currentHour,
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* 週1回および昇格時のバックアップ促進バナー（クラウド自動同期時は非表示） */}
      {!cloudEnabled && (
        <BackupBanner
          lastBackupAt={settings.lastBackupAt}
          firstUsedAt={settings.firstUsedAt}
          justPromoted={justPromotedBanner}
          palette={palette}
          onOneTapBackup={onOneTapBackup}
          onDismissPromoted={onDismissPromoted}
        />
      )}

      {/* 常時稼働ライブ・ティッカーバー（動く大きめ波形＋横に流れ続ける英語フレーズ＋1タップ試聴） */}
      <div
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="mb-5 border rounded-xl px-4 py-3 flex items-center justify-between gap-3 animate-card-enter overflow-hidden"
        data-testid="home-live-pulse-bar"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
          <div
            className="flex items-end gap-1 h-7 shrink-0 px-1.5 py-1 rounded border"
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
            }}
            aria-hidden="true"
          >
            <span
              style={{ backgroundColor: palette.crimsonText ?? palette.text }}
              className="w-1 h-5 rounded-full audio-wave-bar"
            />
            <span
              style={{ backgroundColor: palette.text }}
              className="w-1 h-5 rounded-full audio-wave-bar"
            />
            <span
              style={{ backgroundColor: palette.amberText ?? palette.text }}
              className="w-1 h-5 rounded-full audio-wave-bar"
            />
            <span
              style={{ backgroundColor: palette.text }}
              className="w-1 h-5 rounded-full audio-wave-bar"
            />
            <span
              style={{ backgroundColor: palette.crimsonText ?? palette.text }}
              className="w-1 h-5 rounded-full audio-wave-bar"
            />
          </div>

          <div className="min-w-0 flex-1 overflow-hidden relative">
            <div className="animate-marquee whitespace-nowrap text-xs sm:text-sm font-bold tracking-wide">
              {[...livePhrases, ...livePhrases].map((item, idx) => (
                <span key={idx} className="inline-flex items-center gap-2 mr-8">
                  <span>{item.en}</span>
                  <span className="opacity-65 font-normal text-xs">
                    — {item.ja}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            void speakEnglishText({
              text: currentLivePhrase.en,
              rate: settings.ttsRate,
            });
          }}
          style={{ borderColor: palette.border, borderBottomWidth: '2px' }}
          className="px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 shrink-0 tactile-btn"
          aria-label="今日のフレーズを聴く"
        >
          <Volume2 size={14} strokeWidth={1.75} color="currentColor" />
          <span>聴く</span>
        </button>
      </div>

      {/* PCでは2カラム表示（左：1タップ開始＆学習モード、右：タブ統合パネル） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左カラム */}
        <div className="space-y-5">
          <ScrollReveal delayMs={40}>
          {/* 親指が届くメインCTA：「今日のおすすめ（1タップですぐ開始）」＋常時回転シナプス・オービット */}
          <div
            style={{
              backgroundColor: palette.card,
              borderColor: palette.text,
              color: palette.text,
            }}
            className="border-2 rounded-xl p-5 space-y-3 relative overflow-hidden"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {/* 常時ゆっくり回転するシナプスリング */}
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="animate-spin-slow shrink-0"
                  aria-hidden="true"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeDasharray="4 3"
                  />
                  <circle cx="12" cy="12" r="3" fill="currentColor" />
                </svg>
                <span className="text-xs font-bold uppercase tracking-wider opacity-80">
                  今日のおすすめ（1タップですぐ開始）
                </span>
              </div>
              <span className="text-xs font-semibold shrink-0">
                今日の復習: {dueCount}問
              </span>
            </div>

            <p className="text-sm opacity-90">{recommendation.reason}</p>

            <button
              type="button"
              onClick={() => onStartMode(recommendation.launch)}
              style={{
                backgroundColor: palette.amberSurface ?? palette.text,
                color: palette.amberSurfaceText ?? palette.card,
                borderColor: palette.text,
                borderBottomWidth: '3px',
              }}
              className="relative overflow-hidden group w-full min-h-[56px] px-5 py-3.5 rounded-lg border font-bold text-base flex items-center justify-center gap-2 tactile-block"
              data-testid="one-tap-start-button"
            >
              <span
                className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-white/25 animate-shimmer"
                aria-hidden="true"
              />
              <Play
                size={20}
                strokeWidth={1.75}
                color="currentColor"
                className="animate-mic-pulse"
              />
              <span>{recommendation.label}</span>
              <ChevronRight
                size={18}
                strokeWidth={2}
                color="currentColor"
                className="animate-nudge"
              />
            </button>
          </div>
          </ScrollReveal>

          {/* 2日以上空いたときのリハビリメニュー提案カード */}
          {suggestRehab && (
            <div
              style={{
                backgroundColor: palette.card,
                borderColor: palette.border,
                color: palette.text,
              }}
              className="border rounded-lg p-4 flex items-center justify-between gap-3"
              data-testid="rehab-suggestion-card"
            >
              <div className="flex items-center gap-2.5 text-xs">
                <Activity size={18} strokeWidth={1.75} color="currentColor" />
                <div>
                  <p className="font-bold text-sm">3分リハビリメニューの提案</p>
                  <p className="opacity-80">
                    久しぶりの再開です。負担の少ない3分セッションで連続リズムを取り戻しましょう。
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onStartMode({ mode: 'rehab', plannedMinutes: 3 })
                }
                style={{
                  borderColor: palette.border,
                  borderBottomWidth: '3px',
                }}
                className="px-3 py-2 rounded border text-xs font-bold tactile-block shrink-0"
              >
                3分開始
              </button>
            </div>
          )}

          {/* 学習モード一覧（1日に何回でも実行可能） */}
          <ScrollReveal delayMs={120}>
          <div
            style={{
              backgroundColor: palette.card,
              borderColor: palette.border,
              color: palette.text,
            }}
            className="border rounded-xl p-5 space-y-4"
          >
            <h2 className="font-bold text-base">
              トレーニングを選ぶ
            </h2>

            {/* サイレントモード */}
            <div
              style={{ borderColor: palette.border }}
              className="border-t pt-3.5 space-y-2"
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                <Headphones size={17} strokeWidth={1.75} color="currentColor" />
                <span>サイレントモード（聴く・並べる）</span>
              </div>
              <p className="text-xs opacity-80">
                {todaySessions.some((s) => s.mode === 'silent')
                  ? '本日2回目以降：今日学んだ表現の高速定着＆耳だけのリスニング'
                  : '声を出さずに、英語の音と語順の感覚を鍛えます'}
              </p>
              <div className="grid grid-cols-4 gap-2 pt-1">
                {([3, 15, 30, 60] as const).map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() =>
                      onStartMode({ mode: 'silent', plannedMinutes: mins })
                    }
                    style={{
                      backgroundColor: palette.background,
                      borderColor: palette.border,
                      borderBottomWidth: '3px',
                    }}
                    className="min-h-[44px] py-2 rounded-lg border font-bold text-xs tactile-block"
                    data-testid={`start-silent-${mins}`}
                  >
                    {mins}分
                  </button>
                ))}
              </div>
            </div>

            {/* 発話ドリルモード */}
            <div
              style={{ borderColor: palette.border }}
              className="border-t pt-3.5 space-y-2"
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                <Mic size={17} strokeWidth={1.75} color="currentColor" />
                <span>発話ドリル（瞬間スピーキング）</span>
              </div>
              <p className="text-xs opacity-80">
                状況カードを見て2秒以内に英語を口から出す実践トレーニング。
              </p>
              <div className="grid grid-cols-3 gap-2 pt-1">
                {([5, 15, 30] as const).map((mins) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() =>
                      onStartMode({ mode: 'speak', plannedMinutes: mins })
                    }
                    style={{
                      backgroundColor: palette.background,
                      borderColor: palette.border,
                      borderBottomWidth: '3px',
                    }}
                    className="min-h-[44px] py-2 rounded-lg border font-bold text-xs tactile-block"
                    data-testid={`start-speak-${mins}`}
                  >
                    {mins}分
                  </button>
                ))}
              </div>
            </div>

            {/* サブモード（Live実戦 / スリープ）：コンパクト2列 */}
            <div
              style={{ borderColor: palette.border }}
              className="border-t pt-3.5 grid grid-cols-2 gap-2.5"
            >
              <button
                type="button"
                onClick={() =>
                  onStartMode({ mode: 'live', plannedMinutes: 20 })
                }
                style={{
                  backgroundColor: palette.background,
                  borderColor: palette.border,
                  borderBottomWidth: '3px',
                }}
                className="p-3 rounded-lg border text-left space-y-1 tactile-block"
                data-testid="start-live-20"
              >
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <Radio size={15} strokeWidth={1.75} color="currentColor" />
                  <span>Live実戦（20分）</span>
                </div>
                <p className="text-[11px] opacity-75">
                  会話ログから弱点を登録
                </p>
              </button>

              <button
                type="button"
                onClick={() =>
                  onStartMode({ mode: 'sleep', plannedMinutes: 3 })
                }
                style={{
                  backgroundColor: palette.background,
                  borderColor: palette.border,
                  borderBottomWidth: '3px',
                }}
                className="p-3 rounded-lg border text-left space-y-1 tactile-block"
                data-testid="start-sleep-3"
              >
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <Moon size={15} strokeWidth={1.75} color="currentColor" />
                  <span>スリープ（3分）</span>
                </div>
                <p className="text-[11px] opacity-75">
                  就寝前の音声聴き流し
                </p>
              </button>
            </div>
          </div>
          </ScrollReveal>
        </div>

        {/* 右カラム：タブ切り替えで1枚に集約（昇格ゲート / 学習カレンダー / ライブラリ） */}
        <ScrollReveal delayMs={180} className="space-y-4">
          <div
            style={{
              backgroundColor: palette.card,
              borderColor: palette.border,
            }}
            className="border rounded-xl p-1.5 grid grid-cols-3 gap-1.5 text-xs font-bold"
            data-testid="home-right-tabs"
          >
            {(
              [
                { key: 'gate', label: '昇格ゲート' },
                { key: 'calendar', label: '学習カレンダー' },
                { key: 'library', label: `ライブラリ (${activeChunks.length})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setRightPanelTab(tab.key)}
                style={{
                  backgroundColor:
                    rightPanelTab === tab.key
                      ? palette.text
                      : 'transparent',
                  color:
                    rightPanelTab === tab.key ? palette.card : palette.text,
                }}
                className="py-2 px-2 rounded-lg transition-colors"
                data-testid={`home-tab-${tab.key}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div key={rightPanelTab} className="animate-card-enter">
          {rightPanelTab === 'gate' ? (
            <PromotionProgress
              gateStatus={gateStatus}
              etaText={etaText}
              bossCooldownUntil={settings.bossCooldownUntil}
              palette={palette}
              onStartBossBattle={() =>
                onStartMode({ mode: 'boss', plannedMinutes: 10 })
              }
            />
          ) : rightPanelTab === 'calendar' ? (
            <div className="space-y-4">
              <HeatmapCalendar
                sessions={sessions}
                aiReports={aiReports}
                palette={palette}
                currentStudyDate={currentStudyDate}
              />
              {aiReports.filter((r) => r.analyst).length > 0 && (
                <div
                  style={{
                    backgroundColor: palette.card,
                    borderColor: palette.border,
                    color: palette.text,
                  }}
                  className="border rounded-xl p-5 space-y-2 text-xs"
                >
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <Sparkles size={16} strokeWidth={1.75} color="currentColor" />
                    <span>専属AI講師からの振り返りメモ</span>
                  </div>
                  {(() => {
                    const latest = [...aiReports]
                      .reverse()
                      .find((r) => r.analyst);
                    if (!latest?.analyst) return null;
                    return (
                      <div className="space-y-1">
                        <p className="font-semibold">
                          ボトルネック分析: {latest.analyst.bottleneck}
                        </p>
                        <p className="opacity-85">
                          成長コメント: {latest.analyst.growth}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                backgroundColor: palette.card,
                borderColor: palette.border,
                color: palette.text,
              }}
              className="border rounded-xl p-5 space-y-3 text-xs"
              data-testid="ai-question-bank-card"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <Sparkles size={16} strokeWidth={1.75} color="currentColor" />
                  <span>あなたの学習ライブラリ</span>
                </div>
                <span className="font-mono font-bold">
                  全 {activeChunks.length} 問
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div
                  style={{
                    backgroundColor: palette.background,
                    borderColor: palette.border,
                  }}
                  className="p-2.5 rounded border"
                >
                  <div className="opacity-75">基本フレーズ</div>
                  <div className="text-base font-bold font-mono">
                    {seedCount}問
                  </div>
                </div>
                <div
                  style={{
                    backgroundColor: palette.background,
                    borderColor: palette.border,
                  }}
                  className="p-2.5 rounded border"
                >
                  <div className="opacity-75">追加フレーズ</div>
                  <div
                    style={{ color: palette.amberText ?? palette.text }}
                    className="text-base font-bold font-mono"
                  >
                    {aiCount}問
                  </div>
                </div>
                <div
                  style={{
                    backgroundColor: palette.background,
                    borderColor: palette.border,
                  }}
                  className="p-2.5 rounded border"
                >
                  <div className="opacity-75">実戦・応用</div>
                  <div className="text-base font-bold font-mono">
                    {liveOrRecompCount}問
                  </div>
                </div>
              </div>

              <p className="opacity-80">
                セッションを完了するたびに新しい表現が自動で5問追加されます。下のボタンから今すぐ追加することもできます。
              </p>

              {onGenerateAiQuestionsNow && (
                <button
                  type="button"
                  disabled={generatingAi}
                  onClick={async () => {
                    setGeneratingAi(true);
                    setAiGenNotice(null);
                    try {
                      const res = await onGenerateAiQuestionsNow();
                      if (res.addedCount > 0) {
                        setAiGenNotice(
                          `新しく ${res.addedCount} 問を追加しました！（次回のトレーニングで優先出題されます）`
                        );
                      } else {
                        setAiGenNotice(
                          '現在追加できる新しいフレーズがありません（重複またはAPI制限・未設定のため）。'
                        );
                      }
                    } finally {
                      setGeneratingAi(false);
                    }
                  }}
                  style={{
                    backgroundColor: palette.background,
                    borderColor: palette.text,
                    borderBottomWidth: '3px',
                  }}
                  className="w-full min-h-[44px] px-4 py-2.5 rounded-lg border font-bold text-xs tactile-block disabled:opacity-50"
                  data-testid="generate-ai-questions-now-button"
                >
                  {generatingAi
                    ? '新しいフレーズを作成中...'
                    : '新しいフレーズを5問追加する'}
                </button>
              )}

              {aiGenNotice && (
                <p
                  className="font-bold pt-1"
                  style={{ color: palette.greenText }}
                >
                  {aiGenNotice}
                </p>
              )}
            </div>
          )}
          </div>
        </ScrollReveal>
      </div>
    </div>
  );
};
