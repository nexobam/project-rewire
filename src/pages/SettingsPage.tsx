// 設定画面（現在のアプリ内容に完全準拠・自動ステップアップ＆クラウド自動同期前提のシンプルな調整画面）

import React from 'react';
import {
  RefreshCw,
  Settings as SettingsIcon,
  Sliders,
  Volume2,
} from 'lucide-react';
import { ScrollReveal } from '../components/ScrollReveal';
import type { ThemePalette } from '../domain/contrast';
import { clampPerTapMs } from '../domain/timingJudge';
import {
  MAX_TTS_RATE,
  MIN_TTS_RATE,
  speakEnglishText,
} from '../services/ttsService';
import type { Settings } from '../types';

export interface SettingsPageProps {
  settings: Settings;
  palette: ThemePalette;
  onUpdateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  onStartRecalibration: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  palette,
  onUpdateSettings,
  onStartRecalibration,
}) => {

  const levelPhaseSummary =
    settings.level === 1
      ? settings.lv1Phase === 'picture'
        ? 'Lv.1 前半（絵カード4択期）'
        : 'Lv.1 後半（語順ブロック期）'
      : `Lv.${settings.level}`;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-bold text-xl">
          <SettingsIcon size={22} strokeWidth={1.75} color="currentColor" />
          <span>アプリ設定</span>
        </div>
        <p className="text-xs opacity-80">
          英語音声のスピード、タップの制限時間、画面の明るさ（昼／夜）を調整できます。
        </p>
      </div>

      {/* 1. 英語音声・操作・判定ゆとり設定 */}
      <ScrollReveal delayMs={40}>
      <div
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-xl p-5 space-y-5"
      >
        <div className="flex items-center gap-2 font-bold text-base">
          <Volume2 size={18} strokeWidth={1.75} color="currentColor" />
          <span>1. 英語音声・効果音・回答スピードの調整</span>
        </div>

        {/* TTS再生速度 (0.7x〜1.2x) ＋ 試聴ボタン */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs space-y-0.5">
            <p className="font-bold text-sm">
              英語音声の話すスピード：{settings.ttsRate.toFixed(2)}倍速
            </p>
            <p className="opacity-80">
              聴き取りにくいときは 0.80〜0.90倍、慣れてきたら 1.00〜1.15倍がおすすめです
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
          className="pt-4 border-t flex items-center justify-between"
        >
          <div className="text-xs">
            <p className="font-bold text-sm">ボタンをタップしたときの効果音</p>
            <p className="opacity-80">
              単語ブロックや選択肢をタップしたときにクリック音を鳴らします
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
          className="pt-4 border-t space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs space-y-0.5">
              <p className="font-bold text-sm">
                語順並べ替えの制限時間（1タップの目安：{settings.perTapMs} ミリ秒）
              </p>
              <p className="opacity-80">
                数字が大きいほど制限時間にゆとりができ、「緑（瞬発クリア）」になりやすくなります
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
                <span>診断で再測定</span>
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
                data-testid={`pertap-preset-${preset.ms}`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      </ScrollReveal>

      {/* 2. 画面のカラーテーマ ＆ 学習フェーズ表示 */}
      <ScrollReveal delayMs={120}>
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
          <span>2. 画面のテーマ ＆ 現在の学習ステップ</span>
        </div>

        {/* 画面のカラーテーマ */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs">
            <p className="font-bold text-sm">画面のカラーテーマ（昼／夜）</p>
            <p className="opacity-80">
              時間帯に応じた自動切替、明るいライト、目に優しいダークから選べます
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
                data-testid={`theme-select-${item.key}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* 現在の学習フェーズ（自動判定で切り替わるため閲覧のみ） */}
        <div
          style={{
            backgroundColor: palette.background,
            borderColor: palette.border,
          }}
          className="p-3.5 rounded-lg border text-xs space-y-1"
          data-testid="learning-phase-status"
        >
          <p className="font-bold">現在のステップ：{levelPhaseSummary}</p>
          <p className="opacity-80">
            出題形式（絵カード4択 → 語順ブロック → 音変化 → ボス戦）は、あなたの直近の正答率と反応速度をもとにアプリ側で自動判定してステップアップします。
          </p>
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
      </ScrollReveal>
    </div>
  );
};
