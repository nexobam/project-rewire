// 発話（STT補助）一致率計算および自己判定優先ロジック

import type { Rating } from '../types';

export const STT_MATCH_THRESHOLD = 0.8;

const CONTRACTION_EXPANSIONS: Record<string, string[]> = {
  "i'm": ['i', 'am'],
  'im': ['i', 'am'],
  "let's": ['let', 'us'],
  'lets': ['let', 'us'],
  "it's": ['it', 'is'],
  "you're": ['you', 'are'],
  "we're": ['we', 'are'],
  "they're": ['they', 'are'],
  "that's": ['that', 'is'],
  "there's": ['there', 'is'],
  "what's": ['what', 'is'],
  "who's": ['who', 'is'],
  "i'll": ['i', 'will'],
  "you'll": ['you', 'will'],
  "we'll": ['we', 'will'],
  "they'll": ['they', 'will'],
  "he'll": ['he', 'will'],
  "she'll": ['she', 'will'],
  "i'd": ['i', 'would'],
  "you'd": ['you', 'would'],
  "we'd": ['we', 'would'],
  "i've": ['i', 'have'],
  "you've": ['you', 'have'],
  "we've": ['we', 'have'],
  "they've": ['they', 'have'],
  "don't": ['do', 'not'],
  'dont': ['do', 'not'],
  "doesn't": ['does', 'not'],
  "didn't": ['did', 'not'],
  "can't": ['can', 'not'],
  'cannot': ['can', 'not'],
  "won't": ['will', 'not'],
  "isn't": ['is', 'not'],
  "aren't": ['are', 'not'],
  "wasn't": ['was', 'not'],
  "weren't": ['were', 'not'],
  "shouldn't": ['should', 'not'],
  "couldn't": ['could', 'not'],
  "wouldn't": ['would', 'not'],
  'gonna': ['going', 'to'],
  'wanna': ['want', 'to'],
  'gotta': ['got', 'to'],
};

const NUMBER_WORD_MAP: Record<string, string> = {
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
  '10': 'ten',
  '11': 'eleven',
  '12': 'twelve',
  '1st': 'first',
  '2nd': 'second',
  '3rd': 'third',
  '4th': 'fourth',
};

/**
 * 英文を小文字化・句読点除去して単語配列に正規化する（数字の英単語化にも対応）
 */
export function normalizeTextToWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length > 0)
    .map((w) => NUMBER_WORD_MAP[w] ?? w);
}

/**
 * 短縮形（I'm -> i am, Let's -> let us, gonna -> going to 等）を展開した単語配列を返す
 */
export function expandContractionsInWords(words: string[]): string[] {
  const expanded: string[] = [];
  for (const w of words) {
    const mapped = CONTRACTION_EXPANSIONS[w];
    if (mapped) {
      expanded.push(...mapped);
    } else {
      expanded.push(w);
    }
  }
  return expanded;
}

function computeWordBagMatch(targetWords: string[], transcriptWords: string[]) {
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
 * ターゲット英文とSTT認識結果の単語単位一致率（0.0〜1.0）を計算する
 * - 小文字化・句読点除去をした単語単位で計算し、80%以上なら一致（isMatched: true）とみなす
 * - 短縮形（"I'm" ⇔ "I am", "Let's" ⇔ "Let us" 等）や数字（"7" ⇔ "seven"）の表記差も自動吸収する
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

  const directResult = computeWordBagMatch(targetWords, transcriptWords);
  const expandedResult = computeWordBagMatch(
    expandContractionsInWords(targetWords),
    expandContractionsInWords(transcriptWords)
  );

  return expandedResult.matchRate > directResult.matchRate
    ? expandedResult
    : directResult;
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
