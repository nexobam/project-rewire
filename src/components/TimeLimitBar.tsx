// リアルタイム制限時間進捗バー（緑→黄→赤の3ゾーン可視化・60fpsアニメーション・レイアウトシフトゼロ）

import React, { useEffect, useState } from 'react';
import { Clock, Headphones, Zap } from 'lucide-react';
import type { ThemePalette } from '../domain/contrast';

export interface TimeLimitBarProps {
  palette: ThemePalette;
  isAudioPlaying: boolean;
  isAnswered: boolean;
  startTimeMs: number;
  frozenElapsedMs?: number;
  greenLimitMs: number;
  yellowLimitMs: number;
  questionKey: string | number;
  hasReplayPenalty?: boolean;
}

type TimerZone = 'waiting' | 'green' | 'yellow' | 'red';

export const TimeLimitBar: React.FC<TimeLimitBarProps> = ({
  palette,
  isAudioPlaying,
  isAnswered,
  startTimeMs,
  frozenElapsedMs,
  greenLimitMs,
  yellowLimitMs,
  questionKey,
  hasReplayPenalty = false,
}) => {
  const [liveElapsedMs, setLiveElapsedMs] = useState<number>(0);

  // 問題切替や音声再生中は経過時間を0にリセットし、計測開始後にrequestAnimationFrameで滑らかに更新
  useEffect(() => {
    if (isAudioPlaying) {
      setLiveElapsedMs(0);
      return;
    }

    if (isAnswered) {
      if (typeof frozenElapsedMs === 'number') {
        setLiveElapsedMs(frozenElapsedMs);
      }
      return;
    }

    let rafId = 0;
    const tick = () => {
      const elapsed = Math.max(0, performance.now() - startTimeMs);
      setLiveElapsedMs(elapsed);
      if (elapsed < yellowLimitMs + 500) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [
    isAudioPlaying,
    isAnswered,
    startTimeMs,
    frozenElapsedMs,
    yellowLimitMs,
    questionKey,
  ]);

  const elapsedMs = isAudioPlaying
    ? 0
    : isAnswered && typeof frozenElapsedMs === 'number'
      ? frozenElapsedMs
      : liveElapsedMs;

  const zone: TimerZone = isAudioPlaying
    ? 'waiting'
    : elapsedMs <= greenLimitMs
      ? 'green'
      : elapsedMs <= yellowLimitMs
        ? 'yellow'
        : 'red';

  const remainingRatio = isAudioPlaying
    ? 1
    : Math.max(0, Math.min(1, 1 - elapsedMs / Math.max(1, yellowLimitMs)));
  const remainingPercent = remainingRatio * 100;

  // 緑→黄の境界線位置（残量ゲージ上の % 位置）
  const greenBoundaryPercent = Math.max(
    5,
    Math.min(95, (1 - greenLimitMs / Math.max(1, yellowLimitMs)) * 100)
  );

  // ゾーン別の配色（視認性・高揚感・落ち着いたコントラストを両立）
  const barGradient =
    zone === 'waiting'
      ? 'linear-gradient(90deg, #38bdf8 0%, #6366f1 100%)'
      : zone === 'green'
        ? 'linear-gradient(90deg, #059669 0%, #10b981 55%, #34d399 100%)'
        : zone === 'yellow'
          ? 'linear-gradient(90deg, #d97706 0%, #f59e0b 55%, #fbbf24 100%)'
          : 'linear-gradient(90deg, #dc2626 0%, #ef4444 100%)';

  const badgeBg =
    zone === 'waiting'
      ? 'rgba(56, 189, 248, 0.14)'
      : zone === 'green'
        ? 'rgba(16, 185, 129, 0.14)'
        : zone === 'yellow'
          ? 'rgba(245, 158, 11, 0.16)'
          : 'rgba(239, 68, 68, 0.16)';

  const badgeColor =
    zone === 'waiting'
      ? '#0284c7'
      : zone === 'green'
        ? '#059669'
        : zone === 'yellow'
          ? '#d97706'
          : '#dc2626';

  const statusLabel =
    zone === 'waiting'
      ? '音声リスニング中（計測待機）'
      : isAnswered
        ? zone === 'green'
          ? hasReplayPenalty
            ? '回答完了（リプレイ上限：黄）'
            : '緑ゾーン内で回答！'
          : zone === 'yellow'
            ? '黄ゾーンで回答'
            : '時間超過（赤判定）'
        : zone === 'green'
          ? hasReplayPenalty
            ? '計測中（リプレイにより上限：黄）'
            : '緑ゾーン（目標タイム内）'
          : zone === 'yellow'
            ? '黄ゾーン（あと少し！）'
            : '赤ゾーン（じっくり確認）';

  const elapsedSec = (elapsedMs / 1000).toFixed(1);
  const greenLimitSec = (greenLimitMs / 1000).toFixed(1);

  return (
    <div
      style={{
        backgroundColor: palette.card,
        borderColor: palette.border,
        color: palette.text,
      }}
      className="border rounded-xl px-4 py-3 space-y-2 shadow-sm"
      data-testid="time-limit-bar"
      data-timer-zone={zone}
    >
      {/* 上段：ステータスバッジ ＋ 経過秒数／緑目標タイム */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <div
          style={{ backgroundColor: badgeBg, color: badgeColor }}
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold transition-colors duration-300"
        >
          {zone === 'waiting' ? (
            <Headphones size={13} strokeWidth={2.2} className="animate-pulse" />
          ) : zone === 'green' ? (
            <Zap size={13} strokeWidth={2.2} />
          ) : (
            <Clock size={13} strokeWidth={2.2} />
          )}
          <span>{statusLabel}</span>
        </div>

        <div className="flex items-center gap-2 font-mono tabular-nums text-xs">
          <span className="font-bold">
            {isAudioPlaying ? '0.0s' : `${elapsedSec}s`}
          </span>
          <span className="opacity-55">/ 緑目安 {greenLimitSec}s</span>
        </div>
      </div>

      {/* 下段：60fpsカウントダウンバー ＋ 緑/黄境界マーカー ＋ 先端発光ヘッド */}
      <div className="relative h-3 rounded-full overflow-hidden bg-black/10 dark:bg-white/10">
        {/* 緑→黄 境界ティック（この線より右にバーが残っているうちが緑ゾーン） */}
        <div
          title={`緑ゾーン境界 (${greenLimitSec}s)`}
          style={{ left: `${greenBoundaryPercent}%` }}
          className="absolute top-0 bottom-0 w-0.5 bg-white/80 dark:bg-slate-900/80 z-20 shadow-sm pointer-events-none"
        />

        {/* メインの進捗バー */}
        <div
          style={{
            width: `${remainingPercent}%`,
            background: barGradient,
            transition: isAudioPlaying
              ? 'width 200ms ease-out'
              : 'background 300ms ease',
          }}
          className="relative h-full rounded-full overflow-hidden"
        >
          {/* 斜めストライプの流れ演出（待機中・回答前） */}
          {!isAnswered && (
            <div className="absolute inset-0 timer-bar-stripes opacity-65" />
          )}
        </div>

        {/* バー先端のグロウヘッド（0%超のとき表示） */}
        {remainingPercent > 2 && !isAnswered && !isAudioPlaying && (
          <div
            style={{
              left: `calc(${remainingPercent}% - 6px)`,
              backgroundColor:
                zone === 'green'
                  ? '#6ee7b7'
                  : zone === 'yellow'
                    ? '#fde68a'
                    : '#fca5a5',
            }}
            className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full z-30 shadow-md pointer-events-none ${
              zone === 'yellow' ? 'timer-head-urgent' : ''
            }`}
          />
        )}
      </div>
    </div>
  );
};
