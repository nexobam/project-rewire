// 設定・バックアップ管理画面（perTapMs再測定・Gemini APIキー＆モデル設定・TTS速度・クリック音・Lv.4 All English・防御的JSONインポート確認ダイアログ・要件6-8, 8）

import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Download,
  Key,
  RefreshCw,
  Settings as SettingsIcon,
  Upload,
} from 'lucide-react';
import {
  exportBackupJson,
  validateAndPreviewImportJson,
  type ImportComparisonSummary,
  type ValidatedBackupBundle,
} from '../db/backup';
import type { ThemePalette } from '../domain/contrast';
import { clampPerTapMs } from '../domain/timingJudge';
import { MIN_TTS_RATE, MAX_TTS_RATE } from '../services/ttsService';
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
  onUpdateSettings,
  onStartRecalibration,
  onApplyImportedBackup,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState(settings.geminiApiKey ?? '');
  const [modelInput, setModelInput] = useState(settings.geminiModel);
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

  const handleSaveApiConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const limitNum = Math.max(1, parseInt(dailyLimitInput, 10) || 40);
    await onUpdateSettings({
      geminiApiKey: apiKeyInput.trim() || undefined,
      geminiModel: modelInput.trim() || 'gemini-2.5-flash',
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
        err instanceof Error ? err.message : 'インポートデータの検証に失敗しました。'
      );
    }
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
      <div className="flex items-center gap-2 font-bold text-xl">
        <SettingsIcon size={22} strokeWidth={1.75} color="currentColor" />
        <span>設定・データ保護</span>
      </div>

      {/* 1. タップ速度（perTapMs）・音声・操作設定 */}
      <div
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-xl p-5 space-y-4"
      >
        <h2 className="font-bold text-base">
          1. 動的タイムリミット（perTapMs）・音声・UI設定
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs space-y-0.5">
            <p className="font-bold text-sm">
              基準タップ間隔（<code>perTapMs</code>）：{settings.perTapMs} ms
            </p>
            <p className="opacity-80">
              範囲: 350〜700ms（語順ブロック完了基準 = perTapMs × ブロック数 + 800ms）
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
              className="w-24 px-2.5 py-1.5 rounded border text-sm font-mono"
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
              <span>再測定する</span>
            </button>
          </div>
        </div>

        {/* TTS再生速度 (0.7x〜1.2x) */}
        <div
          style={{ borderColor: palette.border }}
          className="pt-3 border-t flex flex-wrap items-center justify-between gap-3"
        >
          <div className="text-xs">
            <p className="font-bold text-sm">
              英語読み上げ速度（TTS Rate）：{settings.ttsRate.toFixed(2)}x
            </p>
            <p className="opacity-80">0.7x（ゆっくり）〜 1.2x（高速）</p>
          </div>
          <input
            type="range"
            min={MIN_TTS_RATE}
            max={MAX_TTS_RATE}
            step={0.05}
            value={settings.ttsRate}
            onChange={(e) =>
              void onUpdateSettings({ ttsRate: Number(e.target.value) })
            }
            className="w-44"
            aria-label="読み上げ速度"
          />
        </div>

        {/* Web Audio クリック音 ON/OFF */}
        <div
          style={{ borderColor: palette.border }}
          className="pt-3 border-t flex items-center justify-between"
        >
          <div className="text-xs">
            <p className="font-bold text-sm">Web Audio クリック音</p>
            <p className="opacity-80">
              ブロックやボタンをタップしたときに控えめなクリック音を鳴らします
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

        {/* Lv.4 All English モード */}
        {settings.level === 4 && (
          <div
            style={{ borderColor: palette.border }}
            className="pt-3 border-t flex items-center justify-between"
          >
            <div className="text-xs">
              <p className="font-bold text-sm">
                Lv.4 All English モード（日本語のヒント・解説をオフ）
              </p>
              <p className="opacity-80">
                場面タグや回答後の日本語コアイメージ解説を非表示にします
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

      {/* 2. Gemini API設定（APIキーはIndexedDBのみに保存、エクスポート・ログ・URLから除外） */}
      <form
        onSubmit={handleSaveApiConfig}
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-xl p-5 space-y-4"
      >
        <div className="flex items-center gap-2 font-bold text-base">
          <Key size={18} strokeWidth={1.75} color="currentColor" />
          <span>2. Gemini API設定（無料枠・4人のAI社員パイプライン）</span>
        </div>
        <p className="text-xs opacity-80">
          APIキーは端末内のIndexedDBにのみ保存され、JSONバックアップやログ、URLには一切含まれません。未設定やオフライン時は自動的にローカルモックへ切り替わります。
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="space-y-1 sm:col-span-2">
            <label className="font-bold block" htmlFor="gemini-api-key">
              Gemini API Key
            </label>
            <input
              id="gemini-api-key"
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="AIza...（未設定時はローカルモック動作）"
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
              モデル名（初期値: gemini-2.5-flash）
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
              1日あたりの呼び出し上限（初期値: 40回）
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
            本日の使用回数: {settings.apiCallCount ?? 0} /{' '}
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
            API設定を保存
          </button>
        </div>

        {savedNotice && (
          <p className="text-xs font-bold flex items-center gap-1">
            <CheckCircle size={14} strokeWidth={1.75} color="currentColor" />
            <span>設定をIndexedDBに保存しました。</span>
          </p>
        )}
      </form>

      {/* 3. JSONバックアップ（エクスポート／確認ダイアログ付きインポート） */}
      <div
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-xl p-5 space-y-4"
      >
        <h2 className="font-bold text-base">
          3. データ消失・誤上書き防止（JSONバックアップ＆インポート）
        </h2>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs">
            <p className="font-semibold">
              最終バックアップ:{' '}
              {settings.lastBackupAt
                ? new Date(settings.lastBackupAt).toLocaleString('ja-JP')
                : '未実施'}
            </p>
            <p className="opacity-75">
              エクスポートには schemaVersion が含まれ、APIキーは自動的に除外されます。
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
            <span>JSONバックアップを書き出す</span>
          </button>
        </div>

        {/* インポートセクション */}
        <div
          style={{ borderColor: palette.border }}
          className="pt-4 border-t space-y-3"
        >
          <p className="text-xs font-bold">
            JSONバックアップのインポート（10MB制限・プロトタイプ汚染検査・比較確認ダイアログ付き）
          </p>
          <textarea
            rows={5}
            value={importJsonText}
            onChange={(e) => setImportJsonText(e.target.value)}
            placeholder="バックアップしたJSONテキストをここに貼り付けるか、下のボタンで検証してください..."
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
            <span>インポート内容を確認する（まだ上書きしません）</span>
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
                【上書き確認ダイアログ】以下の比較を確認してからインポートを実行してください
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
                  <p className="font-bold">インポート先のデータ</p>
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
                  上記の内容で上書きインポートを実行する
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
              <span>バックアップデータを正常にインポートしました。</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
