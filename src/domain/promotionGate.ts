// 昇格ゲート・Lv.1フェーズ移行・コアセット40問確定・ボス戦・ETA計算ロジック

import type { Attempt, Chunk, Level, Rating, ReviewState } from '../types';
import { recomposeChunk } from './scheduler';
import { diffStudyDatesInDays } from './studyDate';

export const LV1_PICTURE_WINDOW = 30;
export const LV1_PICTURE_ACCURACY_THRESHOLD = 0.85;
export const LV1_PICTURE_GREEN_THRESHOLD = 0.6;

export const GATE_CORE_THRESHOLD = 0.8;
export const GATE_LISTENING_WINDOW = 40;
export const GATE_LISTENING_THRESHOLD = 0.85;
export const GATE_SPEAK_WINDOW = 40;
export const GATE_SPEAK_THRESHOLD = 0.75;

export const BOSS_TOTAL_QUESTIONS = 10;
export const BOSS_PASS_COUNT = 8;
export const BOSS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Lv.1前半（絵カード期）から後半（語順ブロック期）への移行条件判定
 * - 絵カードの直近30問で、正答率85%以上かつ緑が60%以上
 */
export function checkLv1PhaseTransition(attempts: Attempt[]): {
  readyForBlocks: boolean;
  totalSampled: number;
  accuracyRate: number;
  greenRate: number;
} {
  const pictureAttempts = attempts
    .filter((a) => a.exerciseType === 'picture_choice')
    .slice(-LV1_PICTURE_WINDOW);

  if (pictureAttempts.length < LV1_PICTURE_WINDOW) {
    const correctCount = pictureAttempts.filter(
      (a) => a.rating === 'green' || a.rating === 'yellow'
    ).length;
    const greenCount = pictureAttempts.filter((a) => a.rating === 'green').length;
    const denom = pictureAttempts.length || 1;
    return {
      readyForBlocks: false,
      totalSampled: pictureAttempts.length,
      accuracyRate: correctCount / denom,
      greenRate: greenCount / denom,
    };
  }

  const correctCount = pictureAttempts.filter(
    (a) => a.rating === 'green' || a.rating === 'yellow'
  ).length;
  const greenCount = pictureAttempts.filter((a) => a.rating === 'green').length;
  const accuracyRate = correctCount / LV1_PICTURE_WINDOW;
  const greenRate = greenCount / LV1_PICTURE_WINDOW;

  return {
    readyForBlocks:
      accuracyRate >= LV1_PICTURE_ACCURACY_THRESHOLD &&
      greenRate >= LV1_PICTURE_GREEN_THRESHOLD,
    totalSampled: LV1_PICTURE_WINDOW,
    accuracyRate,
    greenRate,
  };
}

/**
 * 単一のコアチャンクが「直近3回中2回以上緑、かつ最新回が緑」（語順ブロック形式の評価だけで集計）を満たしているか判定
 */
export function isCoreChunkMasteredByWordOrder(
  chunkId: string,
  reviewState: ReviewState | undefined,
  attempts?: Attempt[]
): boolean {
  let wordOrderRatings: Rating[] = [];

  if (attempts && attempts.length > 0) {
    wordOrderRatings = attempts
      .filter((a) => a.chunkId === chunkId && a.exerciseType === 'word_order')
      .map((a) => a.rating);
  } else if (reviewState?.wordOrderRatings) {
    wordOrderRatings = reviewState.wordOrderRatings;
  }

  if (wordOrderRatings.length < 2) {
    return false;
  }

  const lastThree = wordOrderRatings.slice(-3);
  const latest = lastThree[lastThree.length - 1];
  const greenCount = lastThree.filter((r) => r === 'green').length;

  return latest === 'green' && greenCount >= 2;
}

export interface GateStatus {
  level: Level;
  coreTotal: number;
  coreMastered: number;
  coreRate: number;
  corePassed: boolean;
  listeningSampled: number;
  listeningRate: number;
  listeningPassed: boolean;
  speakingSampled: number;
  speakingGreenRate: number;
  speakingPassed: boolean;
  bossUnlocked: boolean;
}

/**
 * 現在のレベル（Lv.1〜3）における昇格ゲート①〜③の達成状況を集計する
 * - AIがあとから生成した非コア問題（isCore: false）はゲートの分母に含めない
 * - ①コアセットは語順ブロック形式（word_order）の評価だけで集計する
 */
export function evaluatePromotionGate(params: {
  level: Level;
  chunks: Chunk[];
  reviewStates: ReviewState[];
  attempts: Attempt[];
}): GateStatus {
  const { level, chunks, reviewStates, attempts } = params;

  const coreChunks = chunks.filter((c) => c.level === level && c.isCore && !c.disabled);
  const stateMap = new Map<string, ReviewState>(
    reviewStates.map((s) => [s.chunkId, s])
  );

  let coreMastered = 0;
  for (const chunk of coreChunks) {
    if (
      isCoreChunkMasteredByWordOrder(
        chunk.id,
        stateMap.get(chunk.id),
        attempts
      )
    ) {
      coreMastered += 1;
    }
  }

  const coreTotal = coreChunks.length;
  const coreRate = coreTotal > 0 ? coreMastered / coreTotal : 0;
  const corePassed =
    coreTotal > 0 && coreRate >= GATE_CORE_THRESHOLD - 1e-9;

  // ②リスニング（直近40問）
  const listeningAttempts = attempts
    .filter((a) => {
      if (level === 1) {
        return a.exerciseType === 'sound_change';
      }
      if (level === 2) {
        return (
          a.exerciseType === 'listening_long' ||
          a.exerciseType === 'sound_change'
        );
      }
      return (
        a.exerciseType === 'sound_change' ||
        a.exerciseType === 'listening_long'
      );
    })
    .slice(-GATE_LISTENING_WINDOW);

  const listeningCorrect = listeningAttempts.filter(
    (a) => a.rating === 'green' || a.rating === 'yellow'
  ).length;
  const listeningRate =
    listeningAttempts.length > 0
      ? listeningCorrect / GATE_LISTENING_WINDOW
      : 0;
  const listeningPassed =
    listeningAttempts.length >= GATE_LISTENING_WINDOW &&
    listeningRate >= GATE_LISTENING_THRESHOLD - 1e-9;

  // ③発話（直近40回で緑75%以上）
  const speakingAttempts = attempts
    .filter((a) => {
      if (level === 1) {
        return a.exerciseType === 'speak';
      }
      if (level === 2) {
        return a.exerciseType === 'chunk_building' || a.exerciseType === 'speak';
      }
      return a.exerciseType === 'paraphrase' || a.exerciseType === 'speak';
    })
    .slice(-GATE_SPEAK_WINDOW);

  const speakingGreens = speakingAttempts.filter(
    (a) => a.rating === 'green'
  ).length;
  const speakingGreenRate =
    speakingAttempts.length > 0 ? speakingGreens / GATE_SPEAK_WINDOW : 0;
  const speakingPassed =
    speakingAttempts.length >= GATE_SPEAK_WINDOW &&
    speakingGreenRate >= GATE_SPEAK_THRESHOLD - 1e-9;

  return {
    level,
    coreTotal,
    coreMastered,
    coreRate,
    corePassed,
    listeningSampled: listeningAttempts.length,
    listeningRate,
    listeningPassed,
    speakingSampled: speakingAttempts.length,
    speakingGreenRate,
    speakingPassed,
    bossUnlocked: corePassed && listeningPassed && speakingPassed,
  };
}

/**
 * ETA（昇格までの予測日数）を算出する
 * - 式: 未達のコアチャンク数 ÷ 直近7日間に1日あたり新しく達成したチャンク数
 * - 学習日数が3日未満の場合は「データ収集中（あと◯日で予測を算出）」
 * - 分母が0の場合は「停滞中（予測不可）」
 */
export function calculatePromotionEta(params: {
  remainingCoreChunks: number;
  activeStudyDatesCount: number;
  newlyMasteredInLast7Days: number;
}): {
  days: number | null;
  displayText: string;
} {
  const {
    remainingCoreChunks,
    activeStudyDatesCount,
    newlyMasteredInLast7Days,
  } = params;

  if (activeStudyDatesCount < 3) {
    const remainingDaysToCollect = 3 - activeStudyDatesCount;
    return {
      days: null,
      displayText: `データ収集中（あと${remainingDaysToCollect}日で予測を算出）`,
    };
  }

  if (remainingCoreChunks <= 0) {
    return {
      days: 0,
      displayText: 'コアセット達成済み（0日）',
    };
  }

  const dailyRate = newlyMasteredInLast7Days / 7;
  if (dailyRate <= 0) {
    return {
      days: null,
      displayText: '停滞中（予測不可）',
    };
  }

  const estimatedDays = Math.ceil(remainingCoreChunks / dailyRate);
  return {
    days: estimatedDays,
    displayText: `約${estimatedDays}日`,
  };
}

/**
 * 直近7日間に新しく達成（語順ブロック評価で直近3回中2回以上緑＆最新緑に到達）したコアチャンク数を算出する
 */
export function countNewlyMasteredInLast7Days(params: {
  coreChunks: Chunk[];
  attempts: Attempt[];
  currentStudyDate: string;
}): number {
  const { coreChunks, attempts, currentStudyDate } = params;
  let count = 0;

  for (const chunk of coreChunks) {
    const wordOrderAttempts = attempts.filter(
      (a) => a.chunkId === chunk.id && a.exerciseType === 'word_order'
    );
    if (!isCoreChunkMasteredByWordOrder(chunk.id, undefined, wordOrderAttempts)) {
      continue;
    }
    const latestAttempt = wordOrderAttempts[wordOrderAttempts.length - 1];
    if (
      latestAttempt &&
      diffStudyDatesInDays(latestAttempt.studyDate, currentStudyDate) <= 7
    ) {
      count += 1;
    }
  }

  return count;
}

/**
 * Lv.2〜4に昇格した時点で40チャンクのコアセット（同梱サンプル5問＋AI生成または再構成した35問）を確定する
 * すでに40問確定済みの場合は変更しない
 */
export function lockCoreSetForLevel(
  targetLevel: Level,
  existingChunks: Chunk[]
): Chunk[] {
  if (targetLevel < 2) {
    return existingChunks;
  }

  const levelChunks = existingChunks.filter((c) => c.level === targetLevel && !c.disabled);
  const currentCores = levelChunks.filter((c) => c.isCore);
  if (currentCores.length >= 40) {
    return existingChunks;
  }

  const updatedChunks = existingChunks.map((c) => ({ ...c }));
  // まず該当レベルの既存チャンクを先頭から最大40個まで isCore = true にする
  let lockedCount = 0;
  for (const chunk of updatedChunks) {
    if (chunk.level === targetLevel && !chunk.disabled) {
      if (lockedCount < 40) {
        chunk.isCore = true;
        lockedCount += 1;
      } else {
        chunk.isCore = false;
      }
    }
  }

  // 40個に満たない場合は、同梱サンプル5問をベースに再構成（recomposed）して40チャンクを確定する
  const baseSamples = updatedChunks.filter(
    (c) => c.level === targetLevel && c.isCore
  );
  if (baseSamples.length === 0) {
    return updatedChunks;
  }

  let idx = 1;
  while (lockedCount < 40) {
    const base = baseSamples[(idx - 1) % baseSamples.length];
    const recomposed = recomposeChunk(base, idx);
    recomposed.id = `lv${targetLevel}_core_recomp_${lockedCount + 1}`;
    recomposed.level = targetLevel;
    recomposed.isCore = true;
    updatedChunks.push(recomposed);
    lockedCount += 1;
    idx += 1;
  }

  return updatedChunks;
}

export interface BossQuestion {
  chunk: Chunk;
  exerciseType: 'sound_change' | 'word_order' | 'speak' | 'chunk_building' | 'paraphrase' | 'listening_long';
}

/**
 * ボス戦の全10問（ヒントなし）を編成する
 * - Lv.1の構成：音変化リスニング4問＋語順・発話6問
 * - Lv.2以降：そのLvの主な訓練種目で同じ比率（4問＋6問）
 */
export function buildBossQuestions(level: Level, chunks: Chunk[]): BossQuestion[] {
  const pool = chunks.filter((c) => c.level === level && !c.disabled);
  const fallback = chunks.filter((c) => !c.disabled);
  const source = pool.length >= 10 ? pool : [...pool, ...fallback];

  const questions: BossQuestion[] = [];
  for (let i = 0; i < BOSS_TOTAL_QUESTIONS; i++) {
    const chunk = source[i % source.length];
    if (i < 4) {
      questions.push({
        chunk,
        exerciseType: level === 1 ? 'sound_change' : 'listening_long',
      });
    } else if (i < 7) {
      questions.push({
        chunk,
        exerciseType: 'word_order',
      });
    } else {
      const speakType =
        level === 1
          ? 'speak'
          : level === 2
            ? 'chunk_building'
            : 'paraphrase';
      questions.push({
        chunk,
        exerciseType: speakType,
      });
    }
  }
  return questions;
}

/**
 * ボス戦の合否判定
 * - 黄以内で正解した問題だけを正解として数え、8問以上で合格
 * - 不合格の場合は24時間後に再挑戦可能とし、間違えた問題（赤）のchunkIdリストを返す
 */
export function evaluateBossBattle(
  results: { chunkId: string; rating: Rating }[],
  nowMs: number = Date.now()
): {
  passed: boolean;
  correctCount: number;
  failedChunkIds: string[];
  cooldownUntil?: number;
} {
  const correctCount = results.filter(
    (r) => r.rating === 'green' || r.rating === 'yellow'
  ).length;
  const failedChunkIds = results
    .filter((r) => r.rating === 'red')
    .map((r) => r.chunkId);
  const passed = correctCount >= BOSS_PASS_COUNT;

  return {
    passed,
    correctCount,
    failedChunkIds,
    cooldownUntil: passed ? undefined : nowMs + BOSS_COOLDOWN_MS,
  };
}
