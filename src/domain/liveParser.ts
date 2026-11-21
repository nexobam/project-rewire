// Live実戦モードのプロンプト生成および終了時JSONログ抽出・検証パーサー

import { z } from 'zod';
import type { Chunk, Level, LiveLogSummary } from '../types';

// weakChunks用文字フィルタ：英字・数字・空白・基本的な記号のみ許可（かつ英数字を1文字以上含む）
const SAFE_ENGLISH_CHUNK_REGEX = /^(?=.*[A-Za-z0-9])[A-Za-z0-9\s.,!?'"-]+$/;

const RawLiveJsonSchema = z.object({
  durationMinutes: z.number().optional().default(20),
  overallReview: z.string().min(1),
  goodPoints: z.array(z.string()).default([]),
  badPoints: z.array(z.string()).default([]),
  fluencyScore: z.number().min(1).max(5),
  weakChunks: z.array(z.string()).default([]),
});

/**
 * テキストからコードフェンス内、または最初の対応が取れた {...} を抽出する
 * （前後に雑談の文が混ざっていても抽出可能）
 */
export function extractJsonStringFromText(rawText: string): string | null {
  if (!rawText || typeof rawText !== 'string') {
    return null;
  }

  // 1. コードフェンス ```json ... ``` または ``` ... ``` を優先チェック
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(rawText)) !== null) {
    const fencedContent = match[1].trim();
    const extracted = extractFirstBalancedBraces(fencedContent);
    if (extracted) {
      return extracted;
    }
  }

  // 2. テキスト全体から対応が取れた {...} を順に探索し、JSON.parse に成功するものを返す
  let offset = 0;
  while (offset < rawText.length) {
    const candidate = extractFirstBalancedBraces(rawText.slice(offset));
    if (!candidate) break;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      const idx = rawText.indexOf(candidate, offset);
      offset = idx !== -1 ? idx + 1 : offset + 1;
    }
  }
  return extractFirstBalancedBraces(rawText);
}

/**
 * 文字列リテラル内の波括弧やエスケープを正しく考慮して、最初の対応が取れた {...} を返す
 */
export function extractFirstBalancedBraces(text: string): string | null {
  let startIdx = -1;
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (ch === '{') {
        if (depth === 0) {
          startIdx = i;
        }
        depth += 1;
      } else if (ch === '}') {
        if (depth > 0) {
          depth -= 1;
          if (depth === 0 && startIdx !== -1) {
            return text.slice(startIdx, i + 1);
          }
        }
      }
    }
  }

  return null;
}

export interface ParsedLiveResult {
  summary: LiveLogSummary;
  calendarMinutes: number;
  generatedChunks: Chunk[];
}

/**
 * Live実戦ログのテキストをパース・検証し、学習時間と弱点チャンク（語順／発話専用）へ変換する
 * - weakChunks は最大5件、1件40文字以内、英字・空白・基本的な記号だけを許可
 * - durationMinutes が5〜60ならその値、範囲外なら20分としてカレンダーに加算
 * - 3語以上のものは空白で分割したブロックの語順問題にし、3語未満のものは発話ドリル専用（speakOnly: true）にする
 */
export function parseLiveSessionLog(
  rawText: string,
  currentLevel: Level
): ParsedLiveResult {
  const jsonStr = extractJsonStringFromText(rawText);
  if (!jsonStr) {
    throw new Error('有効なJSONブロックが見つかりませんでした。');
  }

  let parsedObj: unknown;
  try {
    parsedObj = JSON.parse(jsonStr);
  } catch {
    throw new Error('JSONの構文が壊れています。');
  }

  const validated = RawLiveJsonSchema.parse(parsedObj);

  // 学習時間：5〜60ならその値、範囲外なら20分
  const rawMinutes = validated.durationMinutes;
  const calendarMinutes =
    typeof rawMinutes === 'number' && rawMinutes >= 5 && rawMinutes <= 60
      ? Math.round(rawMinutes)
      : 20;

  // weakChunks のフィルタリング（1件40文字以内、英字・空白・基本記号のみ、最大5件）
  const sanitizedWeakChunks = validated.weakChunks
    .map((c) => c.trim().replace(/\s+/g, ' '))
    .filter(
      (c) =>
        c.length > 0 &&
        c.length <= 40 &&
        SAFE_ENGLISH_CHUNK_REGEX.test(c)
    )
    .slice(0, 5);

  const nowIso = new Date().toISOString();
  const generatedChunks: Chunk[] = sanitizedWeakChunks.map((chunkText, idx) => {
    const words = chunkText.split(' ').filter((w) => w.length > 0);
    const isSpeakOnly = words.length < 3;
    const blocks = words.map((w, bIdx) => ({
      id: `live_${Date.now()}_${idx}_b${bIdx}`,
      text: w,
    }));

    return {
      id: `live_${Date.now()}_${idx}`,
      level: Math.max(1, currentLevel) as Level,
      contentCategory:
        /heat|butler|adebayo|spoelstra|miami|nba|court|playoff/i.test(chunkText)
          ? 'heat'
          : 'daily',
      sceneCategory: 'live_review',
      grammarPattern: isSpeakOnly ? 'live_short_phrase' : 'live_sentence',
      enText: chunkText,
      blocks,
      acceptableOrders: [words],
      speakOnly: isSpeakOnly,
      visual: {
        icons: ['MessageSquare', 'Zap'],
        tags: ['会話中', '話し相手', '熱中'],
      },
      coreImageJa: 'Live実戦で詰まった表現。状況と感情をそのまま音に乗せて出す。',
      pronunciationTip: '単語を切らず、ひと息のチャンクとして滑らかに繋げる。',
      hasSoundChange: words.length >= 3,
      source: 'live',
      isCore: false,
      disabled: false,
      createdAt: nowIso,
    };
  });

  const summary: LiveLogSummary = {
    durationMinutes: calendarMinutes,
    overallReview: validated.overallReview,
    goodPoints: validated.goodPoints,
    badPoints: validated.badPoints,
    fluencyScore: Math.round(validated.fluencyScore),
    weakChunks: sanitizedWeakChunks,
  };

  return {
    summary,
    calendarMinutes,
    generatedChunks,
  };
}

/**
 * Live実戦モード開始用のシステムプロンプトを生成する
 */
export function buildLiveSessionPrompt(params: {
  level: Level;
  weakChunks: string[];
  missingGateSummary: string;
}): string {
  const { level, weakChunks, missingGateSummary } = params;
  const speedDesc =
    level <= 1
      ? 'ゆっくり明瞭なテンポ（約120wpm）、短いチャンク中心'
      : level === 2
        ? '自然な日常会話テンポ（約145wpm）、理由や背景の継ぎ足しを促す'
        : level === 3
          ? 'ネイティブ同士のテンポ（約160wpm）、言い換え（パラフレーズ）を引き出す'
          : 'ネイティブ雑談の高速テンポ（約175wpm）、スラングや深い議論を含む';

  const weakList =
    weakChunks.length > 0
      ? weakChunks.slice(0, 5).join(' / ')
      : 'I mean / It feels like / Let me get';

  return `あなたは私の英語会話パートナー（Miami在住の同僚・Miami Heatファン）です。これから20分間の英会話セッション（Lv.${level}）を行います。

【絶対ルール】
1. 会話トピック比率は「日常会話 85% ： Miami Heat（NBA）トーク 15%」で自然に混ぜてください。
2. 話すスピードとレベル感：${speedDesc}
3. 私が言葉に詰まったら、日本語の直訳は絶対に言わず、簡単な英語の言い換えや状況のヒント（助け舟）を出してください。
4. 今日の私の弱点ミッション：「${weakList}」（昇格ゲート課題：${missingGateSummary}）。これらを私が自然に使えるような質問を振ってください。
5. 私が「Finish」と言ったら、会話を終了し、直訳を一切含めず以下のJSON形式のみをコードフェンスで出力してください：

\`\`\`json
{
  "durationMinutes": 20,
  "overallReview": "空間・動き・リズムの観点からの総評（直訳禁止・100字以内）",
  "goodPoints": ["良かった点1", "良かった点2"],
  "badPoints": ["改善点1", "改善点2"],
  "fluencyScore": 4,
  "weakChunks": ["詰まった表現1(40文字以内)", "詰まった表現2"]
}
\`\`\`

まずは軽い挨拶から英語で話しかけてください！`;
}
