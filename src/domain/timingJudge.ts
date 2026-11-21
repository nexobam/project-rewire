// 個人の速度に合わせた動的タイムリミット・語順正誤判定・轟音リプレイ救済ロジック

import type { Rating } from '../types';

export const MIN_PER_TAP_MS = 350;
export const MAX_PER_TAP_MS = 700;
export const DEFAULT_PER_TAP_MS = 500;

/**
 * perTapMs を 350〜700ms の範囲にクランプする
 */
export function clampPerTapMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    return DEFAULT_PER_TAP_MS;
  }
  return Math.round(Math.min(MAX_PER_TAP_MS, Math.max(MIN_PER_TAP_MS, ms)));
}

/**
 * タップ間隔（ms）の配列から中央値を算出し、350〜700ms に収めて返す
 */
export function calculateMedianPerTapMs(tapIntervalsMs: number[]): number {
  const valid = tapIntervalsMs.filter((v) => Number.isFinite(v) && v > 50 && v < 5000);
  if (valid.length === 0) {
    return DEFAULT_PER_TAP_MS;
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  return clampPerTapMs(median);
}

/**
 * 語順ブロックの完了基準時間 completionBudget = perTapMs * blockCount + 800ms
 */
export function calculateCompletionBudget(perTapMs: number, blockCount: number): number {
  const clamped = clampPerTapMs(perTapMs);
  return clamped * blockCount + 800;
}

/**
 * ユーザーが並べたテキスト列が acceptableOrders のいずれかと完全一致するか判定
 */
export function isAcceptableWordOrder(
  userOrder: string[],
  acceptableOrders: string[][]
): boolean {
  if (userOrder.length === 0 || acceptableOrders.length === 0) {
    return false;
  }
  return acceptableOrders.some(
    (acceptable) =>
      acceptable.length === userOrder.length &&
      acceptable.every((word, idx) => word === userOrder[idx])
  );
}

/**
 * リプレイ回数による評価キャップ（轟音リプレイ救済）
 * - 選択肢表示前のリプレイ：1回まではペナルティなし（2回以上は最高評価を黄に制限）
 * - 選択肢表示後のリプレイ：タイマーをリセットするが、最高評価は黄までとする
 */
export function applyReplayCap(
  rawRating: Rating,
  replayBeforeShown: number,
  replayAfterShown: number
): Rating {
  const hasPenalty = replayAfterShown > 0 || replayBeforeShown > 1;
  if (hasPenalty && rawRating === 'green') {
    return 'yellow';
  }
  return rawRating;
}

export interface WordOrderJudgeParams {
  isCorrect: boolean;
  reactionMs: number;
  completionMs: number;
  blockCount: number;
  perTapMs: number;
  replayBeforeShown?: number;
  replayAfterShown?: number;
}

/**
 * 語順ブロックの評価判定（緑／黄／赤）
 * - 緑：正解、かつ反応開始 <= 1200ms、かつ完了 <= completionBudget
 * - 黄：正解、かつ反応開始 <= 2000ms、かつ完了 <= completionBudget + 1500ms
 * - 赤：上記以外、またはミス
 */
export function judgeWordOrderTiming(params: WordOrderJudgeParams): {
  rating: Rating;
  completionBudget: number;
  missType?: 'order_delay';
} {
  const {
    isCorrect,
    reactionMs,
    completionMs,
    blockCount,
    perTapMs,
    replayBeforeShown = 0,
    replayAfterShown = 0,
  } = params;

  const completionBudget = calculateCompletionBudget(perTapMs, blockCount);

  if (!isCorrect) {
    return {
      rating: 'red',
      completionBudget,
      missType: 'order_delay',
    };
  }

  let rawRating: Rating = 'red';
  if (reactionMs <= 1200 && completionMs <= completionBudget) {
    rawRating = 'green';
  } else if (reactionMs <= 2000 && completionMs <= completionBudget + 1500) {
    rawRating = 'yellow';
  } else {
    rawRating = 'red';
  }

  const finalRating = applyReplayCap(rawRating, replayBeforeShown, replayAfterShown);

  return {
    rating: finalRating,
    completionBudget,
    missType: finalRating === 'red' ? 'order_delay' : undefined,
  };
}

export interface PictureChoiceJudgeParams {
  isCorrect: boolean;
  completionMs: number;
  replayBeforeShown?: number;
  replayAfterShown?: number;
  isSoundChange?: boolean;
}

/**
 * 絵カード・音変化4択の評価判定（認知負荷・視覚スキャン時間に基づく人間工学的基準）
 * - 絵カード4択（場所・相手・感情タグ×4枚のスキャン＋判断＋タップ）:
 *   緑 <= 3200ms / 黄 <= 5500ms / 赤 > 5500ms
 * - 音変化・連続多聴4択（英文4本を読む認知負荷を考慮）:
 *   緑 <= 4000ms / 黄 <= 6500ms / 赤 > 6500ms
 */
export function judgePictureChoiceTiming(params: PictureChoiceJudgeParams): {
  rating: Rating;
  missType?: 'sound_change' | 'order_delay';
} {
  const {
    isCorrect,
    completionMs,
    replayBeforeShown = 0,
    replayAfterShown = 0,
    isSoundChange = false,
  } = params;

  if (!isCorrect) {
    return {
      rating: 'red',
      missType: isSoundChange ? 'sound_change' : 'order_delay',
    };
  }

  const greenLimitMs = isSoundChange ? 4000 : 3200;
  const yellowLimitMs = isSoundChange ? 6500 : 5500;

  let rawRating: Rating = 'red';
  if (completionMs <= greenLimitMs) {
    rawRating = 'green';
  } else if (completionMs <= yellowLimitMs) {
    rawRating = 'yellow';
  } else {
    rawRating = 'red';
  }

  const finalRating = applyReplayCap(rawRating, replayBeforeShown, replayAfterShown);

  return {
    rating: finalRating,
    missType:
      finalRating === 'red'
        ? isSoundChange
          ? 'sound_change'
          : 'order_delay'
        : undefined,
  };
}
