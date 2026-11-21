// 発話（STT補助）一致率計算および自己判定優先ロジック

import type { Rating } from '../types';

export const STT_MATCH_THRESHOLD = 0.8;

/**
 * 英文を小文字化・句読点除去して単語配列に正規化する
 */
export function normalizeTextToWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length > 0);
}

/**
 * ターゲット英文とSTT認識結果の単語単位一致率（0.0〜1.0）を計算する
 * - 小文字化・句読点除去をした単語単位で計算し、80%以上なら一致（isMatched: true）とみなす
 */
export function calculateSttMatch(
  targetText: string,
  transcriptText: string
): {
  matchRate: number;
  isMatched: boolean;
  matchedWordsCount: number;
  totalTargetWords: number;
} {
  const targetWords = normalizeTextToWords(targetText);
  const transcriptWords = normalizeTextToWords(transcriptText);

  if (targetWords.length === 0) {
    return {
      matchRate: 0,
      isMatched: false,
      matchedWordsCount: 0,
      totalTargetWords: 0,
    };
  }

  // ターゲットの各単語について、認識結果内の未使用の同一単語とマッチング
  const availableTranscript = [...transcriptWords];
  let matchedCount = 0;

  for (const word of targetWords) {
    const idx = availableTranscript.indexOf(word);
    if (idx !== -1) {
      matchedCount += 1;
      availableTranscript.splice(idx, 1);
    }
  }

  const matchRate = matchedCount / targetWords.length;
  return {
    matchRate,
    isMatched: matchRate >= STT_MATCH_THRESHOLD - 1e-9,
    matchedWordsCount: matchedCount,
    totalTargetWords: targetWords.length,
  };
}

/**
 * 発話ドリルの最終評価決定
 * - 自己判定が主（ボタン：緑／黄／赤）
 * - STTが不一致と判定しても、ユーザーが自己判定で上書きできる
 * - STTの結果だけでSRSを赤にすることは絶対にしない
 */
export function resolveSpeechRating(params: {
  selfJudgedRating: Rating;
  sttMatchRate?: number;
}): {
  finalRating: Rating;
  selfJudged: true;
  sttMatch?: number;
} {
  return {
    finalRating: params.selfJudgedRating,
    selfJudged: true,
    sttMatch: params.sttMatchRate,
  };
}

/**
 * Lv.3 パラフレーズ用：NGワードが含まれているか検査する
 */
export function containsNgWord(text: string, ngWords: string[] = []): string[] {
  if (ngWords.length === 0) return [];
  const words = new Set(normalizeTextToWords(text));
  return ngWords.filter((ng) => words.has(ng.toLowerCase().trim()));
}
