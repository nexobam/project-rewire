// 15問バッチ編成・インターリービング・Miami Heat比率（15%±5%）制御・問題組み替え生成ロジック

import type { Attempt, Block, Chunk, Level, ReviewState } from '../types';
import { shuffleArray } from './shuffle';
import { isReviewDue } from './srs';

export const BATCH_SIZE = 15;
export const TARGET_REVIEW_COUNT = 10;
export const TARGET_NEW_WEAK_COUNT = 5;
export const HEAT_TARGET_RATIO = 0.15;
export const HEAT_MIN_RATIO = 0.1;
export const HEAT_MAX_RATIO = 0.2;

/**
 * 直近100問の履歴と今回選出済みの問題から、次に選ぶべき contentCategory ('heat' | 'daily' | 'any') を判定する
 */
export function getPreferredCategoryForHeatRatio(
  recentCategories: ('daily' | 'heat')[]
): 'heat' | 'daily' | 'any' {
  const windowItems = recentCategories.slice(-99);
  if (windowItems.length < 5) {
    return 'any';
  }
  const heatCount = windowItems.filter((c) => c === 'heat').length;
  const totalNext = windowItems.length + 1;
  const ratioIfDaily = heatCount / totalNext;
  const ratioIfHeat = (heatCount + 1) / totalNext;

  if (ratioIfDaily < HEAT_MIN_RATIO) {
    return 'heat';
  }
  if (ratioIfHeat > HEAT_MAX_RATIO) {
    return 'daily';
  }
  // 15%により近づく方を優先
  return Math.abs(ratioIfHeat - HEAT_TARGET_RATIO) <
    Math.abs(ratioIfDaily - HEAT_TARGET_RATIO)
    ? 'heat'
    : 'daily';
}

/**
 * 2つのチャンクがインターリービング違反（同じ grammarPattern または同じ sceneCategory が連続）かどうか判定
 */
export function hasInterleavingConflict(prev: Chunk | undefined, next: Chunk): boolean {
  if (!prev) {
    return false;
  }
  return (
    prev.grammarPattern === next.grammarPattern ||
    prev.sceneCategory === next.sceneCategory
  );
}

/**
 * 既存のチャンクを組み替えて（source: 'recomposed'）新しいバリエーション問題を生成する
 * （オフラインや新規問題枯渇時でも無限に出題できるようにする）
 */
export function recomposeChunk(baseChunk: Chunk, indexSuffix: number): Chunk {
  // パターンプラクティスまたはチャンク・ビルディングの接頭/接尾組み替えバリエーション
  const modifiers: {
    prefix?: string;
    suffix?: string;
    jaPrefix?: string;
    jaSuffix?: string;
    jaChunkNote: string;
    patternSuffix: string;
    sceneAlt: string;
  }[] = [
    {
      suffix: 'right now',
      jaSuffix: '（今すぐ）',
      jaChunkNote: '→ right now.（たった今・今すぐ）',
      patternSuffix: '_now',
      sceneAlt: 'street',
    },
    {
      suffix: 'for sure',
      jaSuffix: '（間違いなく・確実に）',
      jaChunkNote: '→ for sure.（確実に・間違いなく）',
      patternSuffix: '_sure',
      sceneAlt: 'lounge',
    },
    {
      prefix: 'Honestly',
      jaPrefix: '正直なところ、',
      jaChunkNote: 'Honestly（正直なところ）→ ',
      patternSuffix: '_honest',
      sceneAlt: 'office',
    },
    {
      prefix: 'Actually',
      jaPrefix: '実は、',
      jaChunkNote: 'Actually（実は・実際は）→ ',
      patternSuffix: '_actual',
      sceneAlt: 'station',
    },
    {
      suffix: 'today',
      jaSuffix: '（今日）',
      jaChunkNote: '→ today.（今日）',
      patternSuffix: '_today',
      sceneAlt: 'cafe',
    },
  ];

  // 元文にすでに時間表現（tomorrow, today, right now, tonight 等）がある場合は時間系修飾子を除外して衝突を防ぐ
  const hasTimeAdverb = /\b(tomorrow|today|tonight|right now|now)\b/i.test(
    baseChunk.enText
  );
  const eligibleModifiers = hasTimeAdverb
    ? modifiers.filter((m) => m.suffix !== 'right now' && m.suffix !== 'today')
    : modifiers;

  const mod = eligibleModifiers[indexSuffix % eligibleModifiers.length];
  const baseWords = baseChunk.blocks.map((b) => b.text);
  let newWords: string[];
  let appliedModifier = false;

  if (mod.prefix && baseWords.length <= 7) {
    const firstWordLower =
      baseWords[0] === 'I' || baseWords[0].startsWith('I ')
        ? baseWords[0]
        : baseWords[0].charAt(0).toLowerCase() + baseWords[0].slice(1);
    newWords = [mod.prefix, firstWordLower, ...baseWords.slice(1)];
    appliedModifier = true;
  } else if (mod.suffix && baseWords.length <= 7) {
    const lastWord = baseWords[baseWords.length - 1].replace(/[.!?]+$/, '');
    const punct = baseChunk.enText.match(/[.!?]+$/)?.[0] ?? '.';
    newWords = [
      ...baseWords.slice(0, -1),
      lastWord,
      `${mod.suffix}${punct}`,
    ];
    appliedModifier = true;
  } else {
    newWords = [...baseWords];
  }

  // ブロック数は 3〜9 個の範囲内に収める
  if (newWords.length > 9) {
    newWords = [...baseWords];
    appliedModifier = false;
  }

  const enText = newWords.join(' ');
  const blocks: Block[] = newWords.map((text, idx) => ({
    id: `recomp_${baseChunk.id}_${indexSuffix}_b${idx}`,
    text,
  }));

  const altScene =
    baseChunk.sceneCategory === mod.sceneAlt
      ? `${baseChunk.sceneCategory}_alt`
      : mod.sceneAlt;

  // 組み替え後の英文に合わせて coreImageJa と soundChangeChoices も確実に同期させる
  let updatedCoreImageJa = baseChunk.coreImageJa;
  if (appliedModifier) {
    const parts = baseChunk.coreImageJa.split('／');
    const rawMeaning = (parts[0] ?? baseChunk.coreImageJa)
      .replace(/^\s*【言いたいこと】\s*/, '')
      .trim();
    const rawBreakdown =
      parts.length > 1
        ? parts
            .slice(1)
            .join('／')
            .replace(/^\s*【英語の語順】\s*/, '')
            .trim()
        : baseWords.join(' → ');

    const newMeaning = mod.jaPrefix
      ? `${mod.jaPrefix}${rawMeaning}`
      : `${rawMeaning}${mod.jaSuffix ?? ''}`;
    const newBreakdown = mod.prefix
      ? `${mod.jaChunkNote}${rawBreakdown}`
      : `${rawBreakdown} ${mod.jaChunkNote}`;

    updatedCoreImageJa = `【言いたいこと】${newMeaning} ／ 【英語の語順】${newBreakdown}`;
  }

  const updatedSoundChangeChoices = baseChunk.soundChangeChoices
    ? [
        enText,
        ...baseChunk.soundChangeChoices
          .filter((c) => c !== baseChunk.enText && c !== enText)
          .slice(0, 3),
      ]
    : undefined;

  return {
    ...baseChunk,
    id: `recomposed_${baseChunk.id}_${indexSuffix}`,
    enText,
    blocks,
    acceptableOrders: [newWords],
    coreImageJa: updatedCoreImageJa,
    soundChangeChoices: updatedSoundChangeChoices,
    grammarPattern: `${baseChunk.grammarPattern}${mod.patternSuffix}`,
    sceneCategory: altScene,
    source: 'recomposed',
    isCore: false,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 候補リストをインターリービング制約（同一 grammarPattern / sceneCategory 連続禁止）と
 * Miami Heat 比率（15%±5%）を満たす順序に並べ替えて選出する
 */
export function selectInterleavedBatch(params: {
  candidates: Chunk[];
  batchSize?: number;
  recentHistoryCategories?: ('daily' | 'heat')[];
  fallbackPool?: Chunk[];
}): Chunk[] {
  const {
    candidates,
    batchSize = BATCH_SIZE,
    recentHistoryCategories = [],
    fallbackPool = [],
  } = params;

  const pool = [...candidates.filter((c) => !c.disabled)];
  const backup = [...fallbackPool.filter((c) => !c.disabled)];
  const selected: Chunk[] = [];
  const runningCategories: ('daily' | 'heat')[] = [...recentHistoryCategories];
  let recomposeCounter = 0;

  while (selected.length < batchSize) {
    const prevChunk = selected[selected.length - 1];
    const preferredCat = getPreferredCategoryForHeatRatio(runningCategories);

    // 1. インターリービング違反がなく、希望カテゴリに合致する候補を探す
    let idx = pool.findIndex(
      (c) =>
        !hasInterleavingConflict(prevChunk, c) &&
        (preferredCat === 'any' || c.contentCategory === preferredCat)
    );

    // 2. バックアッププールから希望カテゴリかつインターリービング違反なしを探す
    if (idx === -1 && preferredCat !== 'any') {
      const backupIdx = backup.findIndex(
        (c) =>
          !hasInterleavingConflict(prevChunk, c) &&
          c.contentCategory === preferredCat &&
          !selected.some((s) => s.id === c.id)
      );
      if (backupIdx !== -1) {
        const chosen = backup.splice(backupIdx, 1)[0];
        selected.push(chosen);
        runningCategories.push(chosen.contentCategory);
        continue;
      }
    }

    // 3. カテゴリ制約を緩め、インターリービング違反がない候補を探す
    if (idx === -1) {
      idx = pool.findIndex((c) => !hasInterleavingConflict(prevChunk, c));
    }

    if (idx !== -1) {
      const chosen = pool.splice(idx, 1)[0];
      selected.push(chosen);
      runningCategories.push(chosen.contentCategory);
      continue;
    }

    // 4. バックアッププールからインターリービング違反なしを探す
    const backupAnyIdx = backup.findIndex(
      (c) =>
        !hasInterleavingConflict(prevChunk, c) &&
        !selected.some((s) => s.id === c.id)
    );
    if (backupAnyIdx !== -1) {
      const chosen = backup.splice(backupAnyIdx, 1)[0];
      selected.push(chosen);
      runningCategories.push(chosen.contentCategory);
      continue;
    }

    // 5. 問題が足りない、または全候補がインターリービング衝突する場合は既存チャンクから組み替え生成（recomposed）
    const sourceForRecompose =
      pool.find((c) =>
        preferredCat === 'any' ? true : c.contentCategory === preferredCat
      ) ??
      candidates.find((c) =>
        preferredCat === 'any' ? true : c.contentCategory === preferredCat
      ) ??
      fallbackPool[0] ??
      candidates[0];

    if (!sourceForRecompose) {
      break;
    }

    recomposeCounter += 1;
    let recomposed = recomposeChunk(sourceForRecompose, recomposeCounter);
    if (hasInterleavingConflict(prevChunk, recomposed)) {
      recomposeCounter += 1;
      recomposed = recomposeChunk(sourceForRecompose, recomposeCounter);
      if (hasInterleavingConflict(prevChunk, recomposed)) {
        recomposed = {
          ...recomposed,
          grammarPattern: `${recomposed.grammarPattern}_v${recomposeCounter}`,
          sceneCategory: `${recomposed.sceneCategory}_v${recomposeCounter}`,
        };
      }
    }
    selected.push(recomposed);
    runningCategories.push(recomposed.contentCategory);
  }

  return selected;
}

export interface BuildSessionBatchParams {
  allChunks: Chunk[];
  reviewStates: ReviewState[];
  recentAttempts: Attempt[];
  currentStudyDate: string;
  currentLevel: Level;
  mode: 'silent' | 'speak' | 'rehab';
  batchSize?: number;
}

/**
 * 15問を1バッチとして編成する
 * - 内訳：「SRSの期限が来た復習10問」＋「新規・弱点バリエーション5問」
 * - 期限到来問題が10問未満の場合は新規・弱点問題で埋める
 * - Live実戦由来の弱点（source === 'live'）は最優先で含める
 * - 発話ドリル（mode === 'speak'）では今週サイレントモードでクリアした表現を優先する（サイレント→発話ブリッジ）
 */
export function buildSessionBatch(params: BuildSessionBatchParams): Chunk[] {
  const {
    allChunks,
    reviewStates,
    recentAttempts,
    currentStudyDate,
    currentLevel,
    mode,
    batchSize = BATCH_SIZE,
  } = params;

  // 毎回同じ固定順（lv1_01, lv1_02...）にならないよう最初にシャッフルしてから優先度別に分類する
  const activeChunks = shuffleArray(
    allChunks.filter((c) => {
      if (c.disabled) return false;
      if (mode !== 'speak' && c.speakOnly) return false;
      return c.level <= Math.max(1, currentLevel);
    })
  );

  const stateMap = new Map<string, ReviewState>();
  for (const rs of reviewStates) {
    stateMap.set(rs.chunkId, rs);
  }

  // 直近100問の contentCategory 履歴を復元
  const chunkMap = new Map<string, Chunk>(allChunks.map((c) => [c.id, c]));
  const recentHistoryCategories: ('daily' | 'heat')[] = recentAttempts
    .slice(-100)
    .map((a) => chunkMap.get(a.chunkId)?.contentCategory)
    .filter((cat): cat is 'daily' | 'heat' => cat === 'daily' || cat === 'heat');

  // 今週サイレントモードで緑または黄クリアした chunkId セット（サイレント→発話ブリッジ用）
  const silentClearedIds = new Set<string>();
  if (mode === 'speak') {
    for (const att of recentAttempts) {
      if (
        att.inputMode === 'silent' &&
        (att.rating === 'green' || att.rating === 'yellow')
      ) {
        silentClearedIds.add(att.chunkId);
      }
    }
  }

  // 1. SRS期限到来（または Live最優先）の復習問題を抽出
  const dueChunks: Chunk[] = [];
  const newOrWeakChunks: Chunk[] = [];

  for (const chunk of activeChunks) {
    const state = stateMap.get(chunk.id);
    if (chunk.source === 'live' && (!state || isReviewDue(state, currentStudyDate))) {
      dueChunks.unshift(chunk); // Live弱点は最優先
    } else if (state && isReviewDue(state, currentStudyDate)) {
      dueChunks.push(chunk);
    } else {
      newOrWeakChunks.push(chunk);
    }
  }

  // 発話モードならサイレントクリア済みの問題を優先ソート
  if (mode === 'speak') {
    const prioritizeSilentCleared = (a: Chunk, b: Chunk) => {
      const aCleared = silentClearedIds.has(a.id) ? 1 : 0;
      const bCleared = silentClearedIds.has(b.id) ? 1 : 0;
      return bCleared - aCleared;
    };
    dueChunks.sort(prioritizeSilentCleared);
    newOrWeakChunks.sort(prioritizeSilentCleared);
  } else {
    // 弱点（最新評価が red のもの）→ 未学習のAI新規生成問題 → 未学習シード問題の順で優先
    newOrWeakChunks.sort((a, b) => {
      const sa = stateMap.get(a.id);
      const sb = stateMap.get(b.id);
      const score = (c: Chunk, s?: ReviewState) => {
        if (s?.recentRatings[s.recentRatings.length - 1] === 'red') return 3;
        if (!s && c.source === 'ai') return 2;
        if (!s) return 1;
        return 0;
      };
      return score(b, sb) - score(a, sa);
    });
  }

  const targetReviews = Math.min(TARGET_REVIEW_COUNT, batchSize);
  const selectedDue = dueChunks.slice(0, targetReviews);
  const remainingSlots = batchSize - selectedDue.length;
  const selectedNewWeak = newOrWeakChunks.slice(0, remainingSlots);

  const combinedCandidates = [...selectedDue, ...selectedNewWeak];

  return selectInterleavedBatch({
    candidates: combinedCandidates,
    batchSize,
    recentHistoryCategories,
    fallbackPool: activeChunks,
  });
}
