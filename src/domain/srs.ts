// SRS（間隔反復）スケジュール遷移ロジック

import type { ExerciseType, Rating, ReviewState } from '../types';
import { addDaysToStudyDate } from './studyDate';

export const SRS_INTERVAL_DAYS: readonly [number, number, number, number, number] = [
  1, 3, 7, 14, 30,
];

export const SPOT_CHECK_DAYS = 90;

/**
 * 新規チャンク用の初期 ReviewState を作成する
 */
export function createInitialReviewState(
  chunkId: string,
  currentStudyDate: string
): ReviewState {
  return {
    chunkId,
    stage: 0,
    dueDate: currentStudyDate,
    graduated: false,
    recentRatings: [],
    wordOrderRatings: [],
  };
}

/**
 * 回答結果（緑／黄／赤）に基づいて ReviewState を更新する
 * - 復習間隔の段階: [1, 3, 7, 14, 30] 日 (stage 0..4)
 * - 緑: 次の段階へ進む。30日の段階(stage 4)で緑をとったら「卒業(graduated=true)」とし、90日後に抜き打ちで1回出す
 * - 黄: 同じ段階のまま、同じ間隔で再スケジュールする
 * - 赤: 段階0（1日後）に戻す。卒業済みでも卒業を取り消す
 */
export function updateReviewState(
  prev: ReviewState,
  rating: Rating,
  currentStudyDate: string,
  exerciseType?: ExerciseType
): ReviewState {
  const recentRatings = [...prev.recentRatings, rating].slice(-10);
  const prevWordOrder = prev.wordOrderRatings ?? [];
  const wordOrderRatings =
    exerciseType === 'word_order'
      ? [...prevWordOrder, rating].slice(-10)
      : prevWordOrder;

  if (rating === 'red') {
    return {
      chunkId: prev.chunkId,
      stage: 0,
      dueDate: addDaysToStudyDate(currentStudyDate, SRS_INTERVAL_DAYS[0]),
      graduated: false,
      spotCheckDate: undefined,
      recentRatings,
      wordOrderRatings,
    };
  }

  if (rating === 'yellow') {
    const interval = SRS_INTERVAL_DAYS[prev.stage];
    if (prev.graduated) {
      // 卒業後の抜き打ち等で黄だった場合は30日後に再確認
      return {
        ...prev,
        dueDate: addDaysToStudyDate(currentStudyDate, SRS_INTERVAL_DAYS[4]),
        spotCheckDate: addDaysToStudyDate(currentStudyDate, SRS_INTERVAL_DAYS[4]),
        recentRatings,
        wordOrderRatings,
      };
    }
    return {
      ...prev,
      dueDate: addDaysToStudyDate(currentStudyDate, interval),
      recentRatings,
      wordOrderRatings,
    };
  }

  // rating === 'green'
  if (prev.graduated) {
    // 90日後抜き打ちテストも緑でクリアした場合、抜き打ち完了
    return {
      ...prev,
      spotCheckDate: undefined,
      dueDate: addDaysToStudyDate(currentStudyDate, 3650),
      recentRatings,
      wordOrderRatings,
    };
  }

  if (prev.stage === 4) {
    // 30日の段階で緑をとったら卒業とし、90日後に抜き打ちで1回出す
    const spotDate = addDaysToStudyDate(currentStudyDate, SPOT_CHECK_DAYS);
    return {
      chunkId: prev.chunkId,
      stage: 4,
      dueDate: spotDate,
      graduated: true,
      spotCheckDate: spotDate,
      recentRatings,
      wordOrderRatings,
    };
  }

  const nextStage = (prev.stage + 1) as 0 | 1 | 2 | 3 | 4;
  const nextInterval = SRS_INTERVAL_DAYS[nextStage];
  return {
    chunkId: prev.chunkId,
    stage: nextStage,
    dueDate: addDaysToStudyDate(currentStudyDate, nextInterval),
    graduated: false,
    spotCheckDate: undefined,
    recentRatings,
    wordOrderRatings,
  };
}

/**
 * 指定した学習日において復習期限が到来しているか判定する
 * （卒業済みの場合は spotCheckDate が到来している場合のみ true）
 */
export function isReviewDue(state: ReviewState, currentStudyDate: string): boolean {
  if (state.graduated) {
    return Boolean(state.spotCheckDate && state.spotCheckDate <= currentStudyDate);
  }
  return state.dueDate <= currentStudyDate;
}
