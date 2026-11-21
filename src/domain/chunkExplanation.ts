// チャンク解説（場面で言いたいこと ／ 英語の語順のまま前から理解）抽出・整形ユーティリティ

import type { Chunk } from '../types';

/**
 * coreImageJa から「この場面で言いたいこと（場面の自然な意味・意図）」を抽出する
 */
export function extractSituationMeaning(chunk: Pick<Chunk, 'coreImageJa'>): string {
  const raw = chunk.coreImageJa ?? '';
  const firstPart = raw.split('／')[0] ?? raw;
  return firstPart
    .replace(/^\s*【言いたいこと】\s*/, '')
    .replace(/^\s*【場面の意図】\s*/, '')
    .trim();
}

/**
 * coreImageJa から「英語の語順のまま前から理解（チャンク分解・コアイメージ）」を抽出する
 * 旧形式（／を含まない）のチャンクであっても、必ず語順ブロック分解＋コアイメージを返す
 */
export function extractWordOrderBreakdown(
  chunk: Pick<Chunk, 'coreImageJa' | 'blocks' | 'enText'>
): string {
  const raw = chunk.coreImageJa ?? '';
  if (raw.includes('／')) {
    return raw
      .split('／')
      .slice(1)
      .join('／')
      .replace(/^\s*【英語の語順】\s*/, '')
      .trim();
  }
  const blockChain =
    chunk.blocks && chunk.blocks.length > 0
      ? chunk.blocks.map((b) => b.text).join(' → ')
      : chunk.enText;
  return `${blockChain} （${raw.trim()}）`;
}
