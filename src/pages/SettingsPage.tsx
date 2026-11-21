// 設定・学習スタイル・AI講師接続・バックアップ管理画面（現在のアプリ内容に完全準拠・専門用語を排除した直感的UI・要件6-8, 8）

import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Cloud,
  Download,
  RefreshCw,
  Settings as SettingsIcon,
  Sliders,
  Sparkles,
  Upload,
  Volume2,
} from 'lucide-react';
import {
  exportBackupJson,
  validateAndPreviewImportJson,
  type ImportComparisonSummary,
  type ValidatedBackupBundle,
} from '../db/backup';
import type { ThemePalette } from '../domain/contrast';
import { clampPerTapMs } from '../domain/timingJudge';
import { getCachedCloudStatus } from '../services/cloudSyncService';
import { normalizeGeminiModelName } from '../services/geminiService';
import {
  MAX_TTS_RATE,
  MIN_TTS_RATE,
  speakEnglishText,
} from '../services/ttsService';
import type {
  AiReport,
  Attempt,
  Chunk,
  CoachMessage,
  ReviewState,
  Session,
  Settings,
} from '../types';

export interface SettingsPageProps {
  settings: Settings;
  chunks: Chunk[];
  reviewStates: ReviewState[];
  attempts: Attempt[];
  sessions: Session[];
  aiReports: AiReport[];
  coachMessages: CoachMessage[];
  palette: ThemePalette;
  cloudEnabled?: boolean;
  serverHasGeminiKey?: boolean;
  onUpdateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  onStartRecalibration: () => void;
  onApplyImportedBackup: (bundle: ValidatedBackupBundle) => Promise<void>;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  chunks,
  reviewStates,
  attempts,
  sessions,
  aiReports,
  coachMessages,
  palette,
  cloudEnabled,
  serverHasGeminiKey,
  onUpdateSettings,
  onStartRecalibration,
  onApplyImportedBackup,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState(settings.geminiApiKey ?? '');
  const [modelInput, setModelInput] = useState(
    normalizeGeminiModelName(settings.geminiModel)
  );
  const [dailyLimitInput, setDailyLimitInput] = useState(
    String(settings.dailyApiCallLimit)
  );
  const [savedNotice, setSavedNotice] = useState(false);

  // インポート確認用ステート
  const [importJsonText, setImportJsonText] = useState('');
  const [importPreview, setImportPreview] =
    useState<ImportComparisonSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);

  const cachedCloud = getCachedCloudStatus();
  const isCloudActive = Boolean(cloudEnabled ?? cachedCloud.cloudAvailable);
  const isServerAiActive = Boolean(
    serverHasGeminiKey ?? cachedCloud.serverHasGeminiKey
  );

  const handleSaveApiConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const limitNum = Math.max(1, parseInt(dailyLimitInput, 10) || 40);
    const normalizedModel = normalizeGeminiModelName(modelInput);
    setModelInput(normalizedModel);
    await onUpdateSettings({
      geminiApiKey: apiKeyInput.trim() || undefined,
      geminiModel: normalizedModel,
      dailyApiCallLimit: limitNum,
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleExportBackup = async () => {
    const updated = await onUpdateSettings({ lastBackupAt: Date.now() });
    const jsonStr = await exportBackupJson({
      settings: updated,
      chunks,
      reviewStates,
      attempts,
      sessions,
      aiReports,
      coachMessages,
    });

    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `project-rewire-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePreviewImport = (rawText: string) => {
    setImportError(null);
    setImportSuccess(false);
    try {
      const preview = validateAndPreviewImportJson(rawText, sessions);
      setImportPreview(preview);
    } catch (err) {
      setImportPreview(null);
      setImportError(
        err instanceof Error
          ? err.message
          : 'バックアップデータの検証に失敗しました。'
      );
    }
  };

  const handleFileLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportJsonText(text);
    handlePreviewImport(text);
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    await onApplyImportedBackup(importPreview.bundle);
    setImportPreview(null);
    setImportJsonText('');
    setImportSuccess(true);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-bold text-xl">
          <SettingsIcon size={22} strokeWidth={1.75} color="currentColor" />
          <span>アプリ設定・学習スタイルの調整</span>
        </div>
        <p className="text-xs opacity-80">
          出題モードの切り替え、英語音声のスピード、回答制限時間のゆとり、AI講師の接続状態やデータ保存をここでいつでも調整できます。
        </p>
      </div>

      {/* 1. 学習スタイル・出題形式・画面テーマ設定 */}
      <div
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-xl p-5 space-y-4"
      >
        <div className="flex items-center gap-2 font-bold text-base">
          <Sliders size={18} strokeWidth={1.75} color="currentColor" />
          <span>1. サイレントモードの出題形式 ＆ 画面テーマ</span>
        </div>

        {/* Lv.1 前半（絵カード4択）と後半（語順ブロック並べ替え）の切り替え */}
        <div className="space-y-2">
          <div className="text-xs space-y-0.5">
            <p className="font-bold text-sm">
              サイレントモードの出題スタイル（現在：
              {settings.lv1Phase === 'picture'
                ? '絵カード4択モード'
                : '語順ブロック並べ替えモード'}
              ）
            </p>
            <p className="opacity-80">
              「英語の音を聴いて4枚の状況カードから選ぶ練習（前半）」と、「英語の音を聴いて英単語ブロックを語順通りに並べる練習（後半）」をいつでも切り替えられます。
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => void onUpdateSettings({ lv1Phase: 'picture' })}
              style={{
                backgroundColor:
                  settings.lv1Phase === 'picture'
                    ? palette.text
                    : palette.background,
                color:
                  settings.lv1Phase === 'picture' ? palette.card : palette.text,
                borderColor: palette.text,
                borderBottomWidth: '3px',
              }}
              className="p-3 rounded-lg border text-left text-xs space-y-1 tactile-block"
              data-testid="select-lv1-phase-picture"
            >
              <p className="font-bold text-sm">
                ① 絵カード4択モード（Lv.1前半）
              </p>
              <p className="opacity-85">
                流れた英語の音を聴いて、合う状況・意味のカードを4枚から1タップで選ぶ入門モード
              </p>
            </button>

            <button
              type="button"
              onClick={() => void onUpdateSettings({ lv1Phase: 'blocks' })}
              style={{
                backgroundColor:
                  settings.lv1Phase === 'blocks'
                    ? palette.text
                    : palette.background,
                color:
                  settings.lv1Phase === 'blocks' ? palette.card : palette.text,
                borderColor: palette.text,
                borderBottomWidth: '3px',
              }}
              className="p-3 rounded-lg border text-left text-xs space-y-1 tactile-block"
              data-testid="select-lv1-phase-blocks"
            >
              <p className="font-bold text-sm">
                ② 語順ブロック並べ替えモード（Lv.1後半〜）
              </p>
              <p className="opacity-85">
                流れた英語の音を聴いて、英単語ブロックを英語の語順のまま前から順に並べる実践モード
              </p>
            </button>
          </div>
        </div>

        {/* 画面の明るさ・テーマ設定 */}
        <div
          style={{ borderColor: palette.border }}
          className="pt-3 border-t flex flex-wrap items-center justify-between gap-3"
        >
          <div className="text-xs">
            <p className="font-bold text-sm">画面のカラーテーマ（昼／夜）</p>
            <p className="opacity-80">
              時間帯に応じた自動切替、明るい和紙調（ライト）、目に優しい暗色（ダーク）から選べます
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {(
              [
                { key: 'auto', label: '自動' },
                { key: 'light', label: 'ライト（昼）' },
                { key: 'dark', label: 'ダーク（夜）' },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() =>
                  void onUpdateSettings({ themePreference: item.key })
                }
                style={{
                  backgroundColor:
                    settings.themePreference === item.key
                      ? palette.text
                      : palette.background,
                  color:
                    settings.themePreference === item.key
                      ? palette.card
                      : palette.text,
                  borderColor: palette.border,
                }}
                className="px-3 py-1.5 rounded-lg border text-xs font-bold"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Lv.4 All English モード */}
        {settings.level === 4 && (
          <div
            style={{ borderColor: palette.border }}
            className="pt-3 border-t flex items-center justify-between"
          >
            <div className="text-xs">
              <p className="font-bold text-sm">
                Lv.4 All English モード（日本語のヒント・解説を隠す）
              </p>
              <p className="opacity-80">
                場面タグや回答後の日本語解説を非表示にし、完全に英語だけでトレーニングします
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                void onUpdateSettings({
                  allEnglishMode: !settings.allEnglishMode,
                })
              }
              style={{
                backgroundColor: settings.allEnglishMode
                  ? palette.text
                  : palette.background,
                color: settings.allEnglishMode ? palette.card : palette.text,
                borderColor: palette.border,
              }}
              className="px-4 py-1.5 rounded-lg border text-xs font-bold"
              data-testid="toggle-all-english"
            >
              {settings.allEnglishMode ? 'ON' : 'OFF'}
            </button>
          </div>
        )}
      </div>

      {/* 2. 英語音声のスピード・効果音・回答制限時間のゆとり設定 */}
      <div
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-xl p-5 space-y-4"
      >
        <div className="flex items-center gap-2 font-bold text-base">
          <Volume2 size={18} strokeWidth={1.75} color="currentColor" />
          <span>2. 英語音声のスピード・効果音・回答制限時間の調整</span>
        </div>

        {/* TTS再生速度 (0.7x〜1.2x) ＋ テスト再生ボタン */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs space-y-0.5">
            <p className="font-bold text-sm">
              英語音声の話すスピード：{settings.ttsRate.toFixed(2)}倍速
            </p>
            <p className="opacity-80">
              聴き取りにくいときは 0.80〜0.90倍（ゆっくり）、慣れてきたら 1.00〜1.15倍（ネイティブ速度）がおすすめです
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={MIN_TTS_RATE}
              max={MAX_TTS_RATE}
              step={0.05}
              value={settings.ttsRate}
              onChange={(e) =>
                void onUpdateSettings({ ttsRate: Number(e.target.value) })
              }
              className="w-36"
              aria-label="読み上げ速度"
            />
            <button
              type="button"
              onClick={() => {
                void speakEnglishText({
                  text: 'Let me get a cold brew.',
                  rate: settings.ttsRate,
                });
              }}
              style={{ borderColor: palette.border, borderBottomWidth: '2px' }}
              className="px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1 tactile-btn"
              data-testid="test-tts-rate-button"
            >
              <Volume2 size={14} strokeWidth={1.75} color="currentColor" />
              <span>速度を試聴</span>
            </button>
          </div>
        </div>

        {/* タップ時のクリック効果音 ON/OFF */}
        <div
          style={{ borderColor: palette.border }}
          className="pt-3 border-t flex items-center justify-between"
        >
          <div className="text-xs">
            <p className="font-bold text-sm">ボタンをタップしたときの効果音</p>
            <p className="opacity-80">
              単語ブロックや選択肢をタップしたときに心地よいクリック音を鳴らします
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              void onUpdateSettings({ clickSound: !settings.clickSound })
            }
            style={{
              backgroundColor: settings.clickSound
                ? palette.text
                : palette.background,
              color: settings.clickSound ? palette.card : palette.text,
              borderColor: palette.border,
            }}
            className="px-4 py-1.5 rounded-lg border text-xs font-bold"
            data-testid="toggle-click-sound"
          >
            {settings.clickSound ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* 語順並べ替えの制限時間（タップ速度のゆとり） */}
        <div
          style={{ borderColor: palette.border }}
          className="pt-3 border-t space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs space-y-0.5">
              <p className="font-bold text-sm">
                語順ブロック並べ替えの制限時間（1タップの目安：{settings.perTapMs}{' '}
                ミリ秒）
              </p>
              <p className="opacity-80">
                数字を大きくするほど制限時間にゆとりができ、「緑（瞬発クリア）」判定になりやすくなります（350〜700ms）
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min={350}
                max={700}
                value={settings.perTapMs}
                onChange={(e) =>
                  void onUpdateSettings({
                    perTapMs: clampPerTapMs(Number(e.target.value)),
                  })
                }
                style={{
                  backgroundColor: palette.background,
                  borderColor: palette.border,
                }}
                className="w-20 px-2.5 py-1.5 rounded border text-sm font-mono"
                aria-label="perTapMs"
              />
              <button
                type="button"
                onClick={onStartRecalibration}
                style={{
                  borderColor: palette.border,
                  borderBottomWidth: '3px',
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-bold tactile-block"
                data-testid="recalibrate-pertap-button"
              >
                <RefreshCw size={14} strokeWidth={1.75} color="currentColor" />
                <span>診断で再測定する</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="opacity-75 font-semibold">かんたん切り替え：</span>
            {[
              { ms: 620, label: 'ゆとり（620ms・じっくり）' },
              { ms: 500, label: '標準（500ms・おすすめ）' },
              { ms: 380, label: '高速（380ms・ストイック）' },
            ].map((preset) => (
              <button
                key={preset.ms}
                type="button"
                onClick={() => void onUpdateSettings({ perTapMs: preset.ms })}
                style={{
                  backgroundColor:
                    settings.perTapMs === preset.ms
                      ? palette.text
                      : palette.background,
                  color:
                    settings.perTapMs === preset.ms
                      ? palette.card
                      : palette.text,
                  borderColor: palette.border,
                }}
                className="px-2.5 py-1 rounded border font-semibold"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. クラウド自動同期 ＆ 専属AI講師（Gemini AI）の接続設定 */}
      <form
        onSubmit={handleSaveApiConfig}
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-xl p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-base">
            <Sparkles size={18} strokeWidth={1.75} color="currentColor" />
            <span>3. 専属AI講師（問題自動作成・質問チャット）の接続設定</span>
          </div>
          <span
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
              color:
                isServerAiActive || Boolean(settings.geminiApiKey)
                  ? (palette.greenText ?? palette.text)
                  : palette.text,
            }}
            className="text-xs font-bold px-2.5 py-1 rounded border flex items-center gap-1.5"
          >
            <Cloud size={14} strokeWidth={1.75} color="currentColor" />
            <span>
              {isServerAiActive
                ? 'クラウドAI講師サーバー連携済み（設定不要で利用可能）'
                : settings.geminiApiKey
                  ? '個人APIキーでAI講師に接続中'
                  : 'スマート解説モード'}
            </span>
          </span>
        </div>

        <div
          style={{
            backgroundColor: palette.background,
            borderColor: palette.border,
          }}
          className="p-3.5 rounded-lg border text-xs space-y-1"
        >
          <p className="font-bold">
            {isCloudActive && isServerAiActive
              ? '現在、Cloudflareサーバー側のGemini AI講師とデータベース（D1）に自動接続されています。'
              : 'AI講師の接続について'}
          </p>
          <p className="opacity-85">
            {isCloudActive && isServerAiActive
              ? '下の「個人のGemini APIキー」は空欄のままで、AI講師への質問チャットもセッション終了時の新問題作成もすべてそのままご利用いただけます（ご自身のAPIキーを個別に使いたい場合のみ入力してください）。'
              : '個人のGemini APIキーを設定すると、専属AI講師によるリアルタイム回答と弱点に応じた新規問題生成が動作します。'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="space-y-1 sm:col-span-2">
            <label className="font-bold block" htmlFor="gemini-api-key">
              個人のGemini APIキー（任意・空欄でサーバー側AI講師を使用）
            </label>
            <input
              id="gemini-api-key"
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={
                isServerAiActive
                  ? '空欄のままでサーバー側のAI講師が動作します'
                  : 'AIza...（未入力時は内蔵スマート解説が動作）'
              }
              style={{
                backgroundColor: palette.background,
                borderColor: palette.border,
              }}
              className="w-full px-3 py-2 rounded border font-mono"
              data-testid="api-key-input"
            />
          </div>

          <div className="space-y-1">
            <label className="font-bold block" htmlFor="gemini-model">
              AI講師のモデル名（推奨: gemini-3.8-flash）
            </label>
            <input
              id="gemini-model"
              type="text"
              value={modelInput}
              onChange={(e) => setModelInput(e.target.value)}
              style={{
                backgroundColor: palette.background,
                borderColor: palette.border,
              }}
              className="w-full px-3 py-2 rounded border font-mono"
              data-testid="gemini-model-input"
            />
          </div>

          <div className="space-y-1">
            <label className="font-bold block" htmlFor="daily-limit">
              1日あたりのAI講師呼び出し上限（初期値: 40回）
            </label>
            <input
              id="daily-limit"
              type="number"
              min={1}
              max={500}
              value={dailyLimitInput}
              onChange={(e) => setDailyLimitInput(e.target.value)}
              style={{
                backgroundColor: palette.background,
                borderColor: palette.border,
              }}
              className="w-full px-3 py-2 rounded border font-mono"
              data-testid="daily-limit-input"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <span className="text-xs opacity-75">
            本日のAI講師利用回数: {settings.apiCallCount ?? 0} /{' '}
            {settings.dailyApiCallLimit} 回
          </span>
          <button
            type="submit"
            style={{
              backgroundColor: palette.text,
              color: palette.card,
              borderColor: palette.text,
              borderBottomWidth: '3px',
            }}
            className="px-5 py-2 rounded-lg font-bold text-xs tactile-block"
            data-testid="save-api-settings-button"
          >
            AI講師設定を保存
          </button>
        </div>

        {savedNotice && (
          <p className="text-xs font-bold flex items-center gap-1">
            <CheckCircle size={14} strokeWidth={1.75} color="currentColor" />
            <span>設定を保存しました。</span>
          </p>
        )}
      </form>

      {/* 4. 学習データのバックアップ（ファイル書き出し・復元） */}
      <div
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-xl p-5 space-y-4"
      >
        <h2 className="font-bold text-base">
          4. 学習データのバックアップ保存・復元
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs space-y-0.5">
            <p className="font-semibold">
              最終ファイル保存日:{' '}
              {settings.lastBackupAt
                ? new Date(settings.lastBackupAt).toLocaleString('ja-JP')
                : 'まだファイルを書き出していません（クラウド＆端末には毎問自動保存中）'}
            </p>
            <p className="opacity-75">
              学習記録は1問ごとに自動保存されていますが、念のため手元にバックアップファイルを残したい場合に書き出せます。
            </p>
          </div>
          <button
            type="button"
            onClick={handleExportBackup}
            style={{
              backgroundColor: palette.amberSurface ?? palette.text,
              color: palette.amberSurfaceText ?? palette.card,
              borderColor: palette.text,
              borderBottomWidth: '3px',
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border font-bold text-xs tactile-block"
            data-testid="export-backup-button"
          >
            <Download size={15} strokeWidth={1.75} color="currentColor" />
            <span>バックアップファイルを保存</span>
          </button>
        </div>

        {/* インポートセクション */}
        <div
          style={{ borderColor: palette.border }}
          className="pt-4 border-t space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold">
              保存したバックアップファイルから学習データを復元する
            </p>
            <label
              style={{ borderColor: palette.border }}
              className="px-3 py-1.5 rounded border text-xs font-semibold cursor-pointer tactile-btn"
            >
              <span>JSONファイルを選択して読み込む</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleFileLoad}
                className="hidden"
              />
            </label>
          </div>

          <textarea
            rows={4}
            value={importJsonText}
            onChange={(e) => setImportJsonText(e.target.value)}
            placeholder="またはバックアップしたJSONテキストをここに貼り付けて、下の確認ボタンを押してください..."
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
              color: palette.text,
            }}
            className="w-full p-3 rounded-lg border text-xs font-mono"
            data-testid="import-json-textarea"
          />

          <button
            type="button"
            onClick={() => handlePreviewImport(importJsonText)}
            style={{
              borderColor: palette.border,
              borderBottomWidth: '3px',
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border font-bold text-xs tactile-block"
            data-testid="preview-import-button"
          >
            <Upload size={15} strokeWidth={1.75} color="currentColor" />
            <span>復元内容を確認する（まだ上書きしません）</span>
          </button>

          {importError && (
            <div
              style={{
                color: palette.crimsonText,
                borderColor: palette.crimsonText,
              }}
              className="p-3 rounded border text-xs font-semibold flex items-center gap-2"
              data-testid="import-error-alert"
            >
              <AlertCircle size={16} strokeWidth={1.75} color="currentColor" />
              <span>{importError}</span>
            </div>
          )}

          {/* 確認ダイアログ：現在とインポート先の累計時間・最終学習日を並べて比較（要件6-8） */}
          {importPreview && (
            <div
              style={{
                backgroundColor: palette.background,
                borderColor: palette.text,
              }}
              className="p-4 rounded-xl border-2 space-y-3 text-xs"
              data-testid="import-confirm-dialog"
            >
              <p className="font-bold text-sm">
                【上書き確認】現在のデータと復元するデータを比較してから実行してください
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div
                  style={{
                    backgroundColor: palette.card,
                    borderColor: palette.border,
                  }}
                  className="p-3 rounded border space-y-1"
                >
                  <p className="font-bold">現在のデータ</p>
                  <p>累計学習時間: {importPreview.currentTotalMinutes} 分</p>
                  <p>最終学習日: {importPreview.currentLastStudyDate}</p>
                </div>
                <div
                  style={{
                    backgroundColor: palette.card,
                    borderColor: palette.border,
                  }}
                  className="p-3 rounded border space-y-1"
                >
                  <p className="font-bold">復元するデータ</p>
                  <p>累計学習時間: {importPreview.incomingTotalMinutes} 分</p>
                  <p>最終学習日: {importPreview.incomingLastStudyDate}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  style={{
                    backgroundColor: palette.text,
                    color: palette.card,
                    borderColor: palette.text,
                    borderBottomWidth: '3px',
                  }}
                  className="px-4 py-2 rounded-lg font-bold text-xs tactile-block"
                  data-testid="confirm-import-overwrite-button"
                >
                  上記の内容でデータを復元（上書き）する
                </button>
                <button
                  type="button"
                  onClick={() => setImportPreview(null)}
                  style={{ borderColor: palette.border }}
                  className="px-4 py-2 rounded-lg border font-semibold text-xs"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {importSuccess && (
            <div
              className="text-xs font-bold flex items-center gap-1.5"
              data-testid="import-success-notice"
            >
              <CheckCircle size={16} strokeWidth={1.75} color="currentColor" />
              <span>バックアップデータを正常に復元しました。</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
