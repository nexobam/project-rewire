// 状況ビジュアルカード（単色SVGアイコン2つ＋日本語の場面タグ3つ［場所／相手／感情］＋場面で言っていること解説）コンポーネント（要件2-1-1, 7）

import React from 'react';
import { extractSituationMeaning } from '../domain/chunkExplanation';
import type { ThemePalette } from '../domain/contrast';
import type { Chunk } from '../types';
import { WhitelistedIcon } from './IconWhitelist';

export interface VisualCardProps {
  chunk: Chunk;
  palette: ThemePalette;
  allEnglishMode?: boolean;
  showEnglishSubtitle?: boolean;
  compact?: boolean;
  onClick?: () => void;
  selected?: boolean;
}

export const VisualCard: React.FC<VisualCardProps> = ({
  chunk,
  palette,
  allEnglishMode = false,
  showEnglishSubtitle = false,
  compact = false,
  onClick,
  selected = false,
}) => {
  const [mainIcon, subIcon] = chunk.visual.icons;
  const [placeTag, partnerTag, emotionTag] = chunk.visual.tags;
  const isHeat = chunk.contentCategory === 'heat';
  const situationMeaning = extractSituationMeaning(chunk);

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      style={{
        backgroundColor: palette.card,
        borderColor: selected ? palette.text : palette.border,
        color: palette.text,
      }}
      className={`w-full text-left border rounded-lg ${
        compact ? 'p-3' : 'p-5'
      } ${onClick ? 'tactile-btn cursor-pointer' : ''}`}
      data-testid={`visual-card-${chunk.id}`}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        {/* 単色SVGアイコン2つの組み合わせ */}
        <div className="flex items-center gap-3">
          <div
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
            }}
            className="p-2.5 rounded-lg border flex items-center justify-center"
          >
            <WhitelistedIcon name={mainIcon} size={compact ? 22 : 28} />
          </div>
          <div
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
            }}
            className="p-2.5 rounded-lg border flex items-center justify-center"
          >
            <WhitelistedIcon name={subIcon} size={compact ? 20 : 24} />
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* 問題ソースバッジ（AI生成・Live弱点・コア問題の見える化） */}
          <span
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
              color:
                chunk.source === 'ai'
                  ? (palette.amberText ?? palette.text)
                  : palette.text,
            }}
            className="text-[11px] font-bold px-2 py-0.5 rounded border"
            data-testid={`chunk-source-${chunk.source}`}
          >
            {chunk.source === 'ai'
              ? 'AI生成'
              : chunk.source === 'live'
                ? 'Live弱点'
                : chunk.source === 'recomposed'
                  ? '弱点応用'
                  : 'コア問題'}
          </span>

          {/* Miami Heat タグのみクリムゾンを許可（要件7・背景トークンと組み合わせて4.5:1以上を確保） */}
          {isHeat && (
            <span
              style={{
                backgroundColor: palette.background,
                color: palette.crimsonText ?? palette.text,
                borderColor: palette.crimsonText ?? palette.border,
              }}
              className="text-xs font-bold px-2 py-0.5 rounded border uppercase tracking-wider"
            >
              MIAMI HEAT
            </span>
          )}
        </div>
      </div>

      {/* 場面タグ3つ（場所／相手／感情の名詞・各8文字以内）＋この場面で言っていること解説。Lv.4 All Englishモード時は非表示 */}
      {!allEnglishMode ? (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span
              style={{
                backgroundColor: palette.background,
                borderColor: palette.border,
              }}
              className="text-xs font-semibold px-2.5 py-1 rounded border"
            >
              場所：{placeTag}
            </span>
            <span
              style={{
                backgroundColor: palette.background,
                borderColor: palette.border,
              }}
              className="text-xs font-semibold px-2.5 py-1 rounded border"
            >
              相手：{partnerTag}
            </span>
            <span
              style={{
                backgroundColor: palette.background,
                borderColor: palette.border,
              }}
              className="text-xs font-semibold px-2.5 py-1 rounded border"
            >
              感情：{emotionTag}
            </span>
          </div>

          <div
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
            }}
            className="p-2.5 rounded border"
            data-testid={`visual-card-intent-${chunk.id}`}
          >
            <span className="text-[11px] font-bold opacity-75 block mb-0.5">
              この場面で言っていること（状況・意図）
            </span>
            <p className="text-sm font-bold leading-snug">{situationMeaning}</p>
          </div>
        </div>
      ) : (
        <div className="text-xs font-semibold uppercase tracking-wider opacity-75">
          Scene: {chunk.sceneCategory} / Pattern: {chunk.grammarPattern}
        </div>
      )}

      {/* Lv.2以降で音声と文字の同時表示が解禁された場合、または回答後のみ表示 */}
      {showEnglishSubtitle && (
        <p
          className="mt-3 pt-3 border-t text-base font-semibold tracking-tight"
          style={{ borderColor: palette.border }}
        >
          {chunk.enText}
        </p>
      )}
    </Wrapper>
  );
};
