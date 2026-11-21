// AI出力の7項目機械検証・重複禁止リスト作成ロジック

import { z } from 'zod';
import {
  ICON_WHITELIST,
  type Block,
  type Chunk,
  type IconName,
  type Level,
} from '../types';

const whitelistSet = new Set<string>(ICON_WHITELIST);

/**
 * AIが生成した1問あたりの生データ用 zod スキーマ
 */
export const AiRawQuestionSchema = z.object({
  contentCategory: z.enum(['daily', 'heat']),
  sceneCategory: z.string().min(1),
  grammarPattern: z.string().min(1),
  enText: z.string().min(1),
  blocks: z.array(z.string().min(1)),
  acceptableOrders: z.array(z.array(z.string().min(1))).min(1),
  icons: z.tuple([z.string(), z.string()]),
  tags: z.tuple([z.string(), z.string(), z.string()]),
  coreImageJa: z.string().min(1),
  pronunciationTip: z.string().min(1),
  hasSoundChange: z.boolean().optional().default(false),
});

export type AiRawQuestion = z.infer<typeof AiRawQuestionSchema>;

/**
 * 直近20件の enText から重複禁止リスト（小文字化・空白正規化済みセット）を作成する
 */
export function buildDuplicateForbidList(recentChunks: Chunk[]): string[] {
  return recentChunks
    .slice(-20)
    .map((c) => c.enText.trim().replace(/\s+/g, ' '));
}

export interface ValidationFailure {
  reason:
    | 'zod_invalid'
    | 'icon_not_whitelisted'
    | 'invalid_tags'
    | 'en_text_too_long'
    | 'block_count_out_of_range'
    | 'missing_en_text_in_acceptable_orders'
    | 'duplicate_en_text';
  detail: string;
}

/**
 * AI出力の単一問題を要件5の7つの基準で機械的に検証する
 * 次のどれかに当てはまる問題は捨てる：
 * 1. zodスキーマに合わない
 * 2. アイコンがホワイトリスト外
 * 3. タグが3つでない、または8文字を超える（空文字も不可）
 * 4. enText が80文字を超える
 * 5. ブロックが3〜9個の範囲外
 * 6. acceptableOrders に enText 自体の並びが含まれていない
 * 7. 重複禁止リスト（直近20件の enText）と重なる
 */
export function validateAiQuestion(
  rawItem: unknown,
  forbidEnTexts: string[],
  targetLevel: Level = 1
): { valid: true; chunk: Chunk } | { valid: false; failure: ValidationFailure } {
  // 1. zodスキーマ検証
  const parsed = AiRawQuestionSchema.safeParse(rawItem);
  if (!parsed.success) {
    return {
      valid: false,
      failure: {
        reason: 'zod_invalid',
        detail: parsed.error.message,
      },
    };
  }

  const data = parsed.data;

  // 2. アイコンがホワイトリスト内か
  if (!whitelistSet.has(data.icons[0]) || !whitelistSet.has(data.icons[1])) {
    return {
      valid: false,
      failure: {
        reason: 'icon_not_whitelisted',
        detail: `Invalid icons: ${data.icons.join(', ')}`,
      },
    };
  }

  // 3. タグが3つであり、各タグが1〜8文字以内か
  if (
    data.tags.length !== 3 ||
    data.tags.some((t) => t.trim().length === 0 || [...t.trim()].length > 8)
  ) {
    return {
      valid: false,
      failure: {
        reason: 'invalid_tags',
        detail: `Invalid tags: ${data.tags.join(' / ')}`,
      },
    };
  }

  // 4. enText が80文字以内か
  const cleanEnText = data.enText.trim().replace(/\s+/g, ' ');
  if (cleanEnText.length > 80) {
    return {
      valid: false,
      failure: {
        reason: 'en_text_too_long',
        detail: `enText length ${cleanEnText.length} > 80`,
      },
    };
  }

  // 5. ブロックが3〜9個の範囲内か
  if (data.blocks.length < 3 || data.blocks.length > 9) {
    return {
      valid: false,
      failure: {
        reason: 'block_count_out_of_range',
        detail: `blocks count ${data.blocks.length} out of 3..9`,
      },
    };
  }

  // 6. acceptableOrders に enText 自体の並びが含まれているか
  // （blocks を結合した文字列が enText と一致し、かつ acceptableOrders の中に blocks と同一の並びが存在するか、または enText を空白分割した並びが含まれるか）
  const joinedBlocks = data.blocks.join(' ').trim().replace(/\s+/g, ' ');
  const matchesBlocksJoin = joinedBlocks === cleanEnText;
  const hasSelfOrder =
    matchesBlocksJoin &&
    data.acceptableOrders.some(
      (order) =>
        order.length === data.blocks.length &&
        order.every((token, idx) => token === data.blocks[idx]) &&
        order.join(' ').trim().replace(/\s+/g, ' ') === cleanEnText
    );

  if (!hasSelfOrder) {
    return {
      valid: false,
      failure: {
        reason: 'missing_en_text_in_acceptable_orders',
        detail: 'acceptableOrders does not contain the exact enText block sequence',
      },
    };
  }

  // 7. 重複禁止リストと重ならないか（大文字小文字を区別せず比較）
  const normalizedForbid = new Set(
    forbidEnTexts.map((t) => t.trim().replace(/\s+/g, ' ').toLowerCase())
  );
  if (normalizedForbid.has(cleanEnText.toLowerCase())) {
    return {
      valid: false,
      failure: {
        reason: 'duplicate_en_text',
        detail: `Duplicate enText: ${cleanEnText}`,
      },
    };
  }

  const chunkId = `ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const blockObjs: Block[] = data.blocks.map((text, idx) => ({
    id: `${chunkId}_b${idx}`,
    text,
  }));

  const chunk: Chunk = {
    id: chunkId,
    level: Math.max(1, targetLevel) as Level,
    contentCategory: data.contentCategory,
    sceneCategory: data.sceneCategory,
    grammarPattern: data.grammarPattern,
    enText: cleanEnText,
    blocks: blockObjs,
    acceptableOrders: data.acceptableOrders,
    speakOnly: false,
    visual: {
      icons: [data.icons[0] as IconName, data.icons[1] as IconName],
      tags: [
        data.tags[0].trim(),
        data.tags[1].trim(),
        data.tags[2].trim(),
      ],
    },
    coreImageJa: data.coreImageJa.slice(0, 100),
    pronunciationTip: data.pronunciationTip,
    hasSoundChange: data.hasSoundChange,
    source: 'ai',
    isCore: false,
    disabled: false,
    createdAt: new Date().toISOString(),
  };

  return { valid: true, chunk };
}

/**
 * 複数のAI生成問題配列を検証し、合格した Chunk のみを返す（リスト内の重複も排除）
 */
export function filterValidAiQuestions(
  rawList: unknown[],
  forbidEnTexts: string[],
  targetLevel: Level = 1
): Chunk[] {
  const validChunks: Chunk[] = [];
  const runningForbid = [...forbidEnTexts];

  for (const item of rawList) {
    const res = validateAiQuestion(item, runningForbid, targetLevel);
    if (res.valid) {
      validChunks.push(res.chunk);
      runningForbid.push(res.chunk.enText);
    }
  }

  return validChunks;
}
