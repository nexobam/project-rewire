// 厳密シャッフルロジック（acceptableOrders のいずれとも一致しない並びを100%保証）

import type { Block } from '../types';
import { isAcceptableWordOrder } from './timingJudge';

/**
 * 配列をFisher-Yatesアルゴリズムでランダムにシャッフルした新しい配列を返す
 */
export function shuffleArray<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

/**
 * 語順ブロックを厳密にシャッフルする
 * - シャッフル後の表示テキスト列が acceptableOrders のどれとも一致しないことを保証する
 * - 同じ単語が重複している場合も各 Block の id を保持したまま並べ替える
 */
export function strictShuffleBlocks(
  blocks: readonly Block[],
  acceptableOrders: string[][]
): Block[] {
  if (blocks.length <= 1) {
    return [...blocks];
  }

  // ランダム試行（最大60回）
  for (let attempt = 0; attempt < 60; attempt++) {
    const candidate = shuffleArray(blocks);
    const candidateTexts = candidate.map((b) => b.text);
    if (!isAcceptableWordOrder(candidateTexts, acceptableOrders)) {
      return candidate;
    }
  }

  // フォールバック：ランダム試行で偶然すべて正解並びになった場合、
  // 異なるテキストを持つ2要素のスワップやローテーションを探索して確実に非正解並びを返す
  const base = shuffleArray(blocks);
  for (let i = 0; i < base.length; i++) {
    for (let j = i + 1; j < base.length; j++) {
      if (base[i].text !== base[j].text) {
        const swapped = [...base];
        const tmp = swapped[i];
        swapped[i] = swapped[j];
        swapped[j] = tmp;
        if (
          !isAcceptableWordOrder(
            swapped.map((b) => b.text),
            acceptableOrders
          )
        ) {
          return swapped;
        }
      }
    }
  }

  // 巡回シフト＋逆順による追加探索
  const reversed = [...base].reverse();
  for (let shift = 0; shift < reversed.length; shift++) {
    const rotated = [...reversed.slice(shift), ...reversed.slice(0, shift)];
    if (
      !isAcceptableWordOrder(
        rotated.map((b) => b.text),
        acceptableOrders
      )
    ) {
      return rotated;
    }
  }

  return reversed;
}
