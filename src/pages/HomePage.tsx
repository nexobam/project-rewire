// ホーム画面（親指1タップ開始「迷ったらこれ」・リハビリ提案・5モード選択・PC 2カラム対応・要件4, 6, 7）

import React from 'react';
import {
  Activity,
  Headphones,
  MessageSquare,
  Mic,
  Moon,
  Play,
  Radio,
  Sparkles,
} from 'lucide-react';
import { BackupBanner } from '../components/BackupBanner';
import { HeatmapCalendar } from '../components/HeatmapCalendar';
import { PromotionProgress } from '../components/PromotionProgress';
import type { ThemePalette } from '../domain/contrast';
import type { GateStatus } from '../domain/promotionGate';
import { isReviewDue } from '../domain/srs';
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
  onOpenCoach: () => void;
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

  // 期限到来のSRS復習が多い場合はサイレント15分、そうでなければ手軽な3分または15分
  if (dueReviewCount >= 5) {
    return {
      label: `サイレントモード（15分）を開始（復習期限 ${dueReviewCount}件）`,
      reason: 'SRSの復習期限が到来しています。音と語順ブロックで瞬発力を維持しましょう。',
      launch: { mode: 'silent', plannedMinutes: 15 },
    };
  }

  return {
    label: 'サイレントモード（15分）を開始',
    reason: '音変化リスニングと語順ブロックの標準15分バッチで英語OSを鍛えます。',
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
  onOpenCoach,
  onOneTapBackup,
  onDismissPromoted,
  onGenerateAiQuestionsNow,
}) => {
  const [generatingAi, setGeneratingAi] = React.useState(false);
  const [aiGenNotice, setAiGenNotice] = React.useState<string | null>(null);

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
          justPromoted={justPromotedBanner}
          palette={palette}
          onOneTapBackup={onOneTapBackup}
          onDismissPromoted={onDismissPromoted}
        />
      )}

      {/* PCでは2カラム表示（左：1タップ開始＆5学習モード、右：昇格ゲート＆ヒートマップカレンダー） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左カラム */}
        <div className="space-y-5">
          {/* 親指が届くメインCTA：「迷ったらこれ（1タップですぐ開始）」 */}
          <div
            style={{
              backgroundColor: palette.card,
              borderColor: palette.text,
              color: palette.text,
            }}
            className="border-2 rounded-xl p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider opacity-75">
                迷ったらこれ（1タップですぐ開始）
              </span>
              <span className="text-xs font-semibold">
                SRS期限到来: {dueCount}問
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
              className="w-full min-h-[56px] px-5 py-3.5 rounded-lg border font-bold text-base flex items-center justify-center gap-2 tactile-block"
              data-testid="one-tap-start-button"
            >
              <Play size={20} strokeWidth={1.75} color="currentColor" />
              <span>{recommendation.label}</span>
            </button>
          </div>

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

          {/* 5つの学習モード一覧（曜日固定なし・1日に何回でも可・要件4） */}
          <div
            style={{
              backgroundColor: palette.card,
              borderColor: palette.border,
              color: palette.text,
            }}
            className="border rounded-lg p-5 space-y-4"
          >
            <h2 className="font-bold text-base">
              5つの学習モード（1日何回でも実行可能）
            </h2>

            {/* 1. サイレントモード */}
            <div
              style={{ borderColor: palette.border }}
              className="border-t pt-3 space-y-2"
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                <Headphones size={17} strokeWidth={1.75} color="currentColor" />
                <span>1. サイレントモード（満員電車・親指タップ）</span>
              </div>
              <p className="text-xs opacity-80">
                {todaySessions.some((s) => s.mode === 'silent')
                  ? '本日2回目以降：今日学んだ問題の高速定着復習＆耳だけのリスニング'
                  : '本日1回目：音変化リスニング・状況カード／語順ブロック瞬発タップ'}
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

            {/* 2. 発話ドリルモード */}
            <div
              style={{ borderColor: palette.border }}
              className="border-t pt-3 space-y-2"
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                <Mic size={17} strokeWidth={1.75} color="currentColor" />
                <span>2. 発話ドリルモード（お手本音声なし・瞬間発話）</span>
              </div>
              <p className="text-xs opacity-80">
                今週サイレントでクリアした表現を優先出題。自己判定3ボタン＋STT認識補助。
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

            {/* 3. Live実戦モード */}
            <div
              style={{ borderColor: palette.border }}
              className="border-t pt-3 flex items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <Radio size={17} strokeWidth={1.75} color="currentColor" />
                  <span>3. Live実戦モード（1回20分）</span>
                </div>
                <p className="text-xs opacity-80">
                  専用プロンプトをワンタップコピー＆終了時のJSONログから弱点チャンクを自動登録。
                </p>
              </div>
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
                className="min-h-[44px] px-4 py-2 rounded-lg border font-bold text-xs tactile-block shrink-0"
                data-testid="start-live-20"
              >
                20分実戦
              </button>
            </div>

            {/* 4. スリープ・プライミングモード */}
            <div
              style={{ borderColor: palette.border }}
              className="border-t pt-3 flex items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <Moon size={17} strokeWidth={1.75} color="currentColor" />
                  <span>4. スリープ・プライミング（就寝前3分）</span>
                </div>
                <p className="text-xs opacity-80">
                  スリープ専用配色に切替。今日苦戦した3チャンクを音声だけで聴き流します。
                </p>
              </div>
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
                className="min-h-[44px] px-4 py-2 rounded-lg border font-bold text-xs tactile-block shrink-0"
                data-testid="start-sleep-3"
              >
                3分開始
              </button>
            </div>

            {/* 5. AIコーチ質問チャット */}
            <div
              style={{ borderColor: palette.border }}
              className="border-t pt-3 flex items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <MessageSquare size={17} strokeWidth={1.75} color="currentColor" />
                  <span>5. AIコーチ質問チャット（直訳禁止解説）</span>
                </div>
                <p className="text-xs opacity-80">
                  コアイメージと例文だけで疑問を解消。オフライン時の質問保存＆再送にも対応。
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenCoach}
                style={{
                  backgroundColor: palette.background,
                  borderColor: palette.border,
                  borderBottomWidth: '3px',
                }}
                className="min-h-[44px] px-4 py-2 rounded-lg border font-bold text-xs tactile-block shrink-0"
                data-testid="open-coach-chat"
              >
                質問する
              </button>
            </div>
          </div>
        </div>

        {/* 右カラム：昇格ゲート進捗＋ヒートマップカレンダー */}
        <div className="space-y-5">
          <PromotionProgress
            gateStatus={gateStatus}
            etaText={etaText}
            bossCooldownUntil={settings.bossCooldownUntil}
            palette={palette}
            onStartBossBattle={() =>
              onStartMode({ mode: 'boss', plannedMinutes: 10 })
            }
          />

          <HeatmapCalendar
            sessions={sessions}
            aiReports={aiReports}
            palette={palette}
            currentStudyDate={currentStudyDate}
          />

          {/* 問題バンク内訳 ＆ 4人のAI社員による新規問題生成パネル */}
          <div
            style={{
              backgroundColor: palette.card,
              borderColor: palette.border,
              color: palette.text,
            }}
            className="border rounded-lg p-5 space-y-3 text-xs"
            data-testid="ai-question-bank-card"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-sm">
                <Sparkles size={16} strokeWidth={1.75} color="currentColor" />
                <span>問題バンク ＆ 4人のAI社員ステータス</span>
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
                <div className="opacity-75">初期コア問題</div>
                <div className="text-base font-bold font-mono">{seedCount}問</div>
              </div>
              <div
                style={{
                  backgroundColor: palette.background,
                  borderColor: palette.border,
                }}
                className="p-2.5 rounded border"
              >
                <div className="opacity-75">AI生成問題</div>
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
                <div className="opacity-75">Live弱点・応用</div>
                <div className="text-base font-bold font-mono">
                  {liveOrRecompCount}問
                </div>
              </div>
            </div>

            <p className="opacity-80">
              セッション完了時（「終了して集計」時）にAI社員が自動で新問題を5問作りますが、下のボタンから今すぐ追加作成することもできます。
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
                    setAiGenNotice(
                      `AI社員が新しく ${res.addedCount} 問を作成しました！（次回のバッチで優先出題されます）`
                    );
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
                  ? '4人のAI社員が新問題を作成・品質監査中...'
                  : '今すぐAI社員に新問題を5問作らせる'}
              </button>
            )}

            {aiGenNotice && (
              <p className="font-bold pt-1" style={{ color: palette.greenText }}>
                {aiGenNotice}
              </p>
            )}
          </div>

          {/* 直近のAI社員コメントサマリー */}
          {aiReports.filter((r) => r.analyst).length > 0 && (
            <div
              style={{
                backgroundColor: palette.card,
                borderColor: palette.border,
                color: palette.text,
              }}
              className="border rounded-lg p-5 space-y-2 text-xs"
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                <Sparkles size={16} strokeWidth={1.75} color="currentColor" />
                <span>AI社員からの最新フィードバック</span>
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
      </div>
    </div>
  );
};
