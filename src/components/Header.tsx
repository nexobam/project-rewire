// ヘッダーコンポーネント（レベル表示・墨色数字＋単色Flame連続記録・テーマ切替・ナビゲーション）

import React from 'react';
import {
  Flame,
  Home,
  MessageSquare,
  Settings as SettingsIcon,
  Ticket,
} from 'lucide-react';
import type { ThemePalette } from '../domain/contrast';
import type { Level } from '../types';

export type NavTab = 'home' | 'coach' | 'settings';

export interface HeaderProps {
  level: Level;
  lv1Phase: 'picture' | 'blocks';
  streakDays: number;
  restTickets: number;
  palette: ThemePalette;
  activeTab: NavTab;
  onChangeTab: (tab: NavTab) => void;
}

const LEVEL_PHASE_LABELS: Record<Level, string> = {
  0: 'Lv.0 初回診断（3分）',
  1: 'Lv.1 音と基本OSの開通期（目安〜90h）',
  2: 'Lv.2 思考拡張・語彙爆発期（目安〜350h）',
  3: 'Lv.3 言い換え・状況対応期（目安〜600h）',
  4: 'Lv.4 ネイティブ雑談・自由発話（目安1,000h+）',
};

export const Header: React.FC<HeaderProps> = ({
  level,
  lv1Phase,
  streakDays,
  restTickets,
  palette,
  activeTab,
  onChangeTab,
}) => {
  const phaseSubText =
    level === 1
      ? lv1Phase === 'picture'
        ? '前半：絵カード期'
        : '後半：語順ブロック期'
      : '';

  return (
    <header
      style={{
        backgroundColor: palette.card,
        borderColor: palette.border,
        color: palette.text,
      }}
      className="border-b px-4 py-3 sticky top-0 z-20"
    >
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onChangeTab('home')}
            className="text-left focus:outline-none"
          >
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-lg">
                Project Rewire
              </span>
              <span
                style={{ borderColor: palette.border }}
                className="text-xs font-semibold px-2 py-0.5 rounded border"
              >
                {LEVEL_PHASE_LABELS[level]}
                {phaseSubText ? ` / ${phaseSubText}` : ''}
              </span>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* 連続記録：墨色（本文色）の数字と単色の Flame アイコン（クリムゾンは絶対に使わない・要件7） */}
          <div
            style={{ borderColor: palette.border, color: palette.text }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border text-sm font-semibold"
            title="連続学習日数"
          >
            <Flame size={16} strokeWidth={1.75} color="currentColor" />
            <span data-testid="streak-days">{streakDays}日連続</span>
          </div>

          {/* お休みチケット残数 */}
          <div
            style={{ borderColor: palette.border, color: palette.text }}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium"
            title="お休みチケット（毎週月曜午前4時に最大2枚まで補充）"
          >
            <Ticket size={15} strokeWidth={1.75} color="currentColor" />
            <span>休票 {restTickets}/2</span>
          </div>

          {/* ナビゲーションボタン */}
          <nav className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onChangeTab('home')}
              style={{
                borderColor: palette.border,
                backgroundColor:
                  activeTab === 'home' ? palette.background : 'transparent',
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-semibold tactile-btn"
            >
              <Home size={15} strokeWidth={1.75} color="currentColor" />
              <span>ホーム</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeTab('coach')}
              style={{
                borderColor: palette.border,
                backgroundColor:
                  activeTab === 'coach' ? palette.background : 'transparent',
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-semibold tactile-btn"
            >
              <MessageSquare size={15} strokeWidth={1.75} color="currentColor" />
              <span>AI講師</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeTab('settings')}
              style={{
                borderColor: palette.border,
                backgroundColor:
                  activeTab === 'settings' ? palette.background : 'transparent',
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-semibold tactile-btn"
            >
              <SettingsIcon size={15} strokeWidth={1.75} color="currentColor" />
              <span>設定</span>
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};
