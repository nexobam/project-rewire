// 状況ビジュアルカード（シーンイラスト図解バナー・SVGアイコン3つ＋場面タグ4つ［場所／相手／状況／焦点］＋場面で言っていること解説）コンポーネント

import React from 'react';
import { extractSituationMeaning } from '../domain/chunkExplanation';
import type { ThemePalette } from '../domain/contrast';
import { getPictureSceneVisualMeta } from '../domain/pictureChoiceDistinct';
import type { Chunk } from '../types';
import { WhitelistedIcon } from './IconWhitelist';

export interface VisualCardProps {
  chunk: Chunk;
  palette: ThemePalette;
  allEnglishMode?: boolean;
  showEnglishSubtitle?: boolean;
  showSituationMeaning?: boolean;
  showCategoryBadge?: boolean;
  compact?: boolean;
  onClick?: () => void;
  selected?: boolean;
}

export const VisualCard: React.FC<VisualCardProps> = ({
  chunk,
  palette,
  allEnglishMode = false,
  showEnglishSubtitle = false,
  showSituationMeaning = false,
  showCategoryBadge = false,
  compact = false,
  onClick,
  selected = false,
}) => {
  const [mainIcon, subIcon] = chunk.visual.icons;
  const [placeTag, partnerTag, situationTag] = chunk.visual.tags;
  const isHeat = chunk.contentCategory === 'heat';
  const situationMeaning = extractSituationMeaning(chunk);
  const visualMeta = getPictureSceneVisualMeta(chunk);

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
      className={`w-full text-left border rounded-xl ${
        compact ? 'p-3.5' : 'p-5'
      } ${onClick ? 'tactile-btn cursor-pointer hover:shadow-md transition-shadow' : ''}`}
      data-testid={`visual-card-${chunk.id}`}
    >
      {/* 上段：シーン別カラーイラスト図解バナー（アイコン3つ＋シーン見出し） */}
      <div
        style={{
          background: visualMeta.softBgCss,
          borderColor: palette.border,
        }}
        className={`rounded-lg border ${compact ? 'p-2.5 mb-2.5' : 'p-3.5 mb-3.5'} space-y-2`}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            style={{
              color: visualMeta.accentHex,
              backgroundColor: palette.card,
              borderColor: palette.border,
            }}
            className="text-[11px] font-extrabold px-2 py-0.5 rounded-full border tracking-tight"
          >
            {visualMeta.sceneTitle}
          </span>

          {isHeat && showCategoryBadge ? (
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
          ) : (
            !allEnglishMode && (
              <span
                style={{
                  backgroundColor: palette.card,
                  borderColor: palette.border,
                }}
                className="text-[11px] font-bold px-2 py-0.5 rounded border opacity-90"
              >
                焦点：{visualMeta.actionTag}
              </span>
            )
          )}
        </div>

        {/* 3アイコンによる状況イラスト構図（主体 × 対象 × キーモチーフ） */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex items-center gap-2">
            <div
              style={{
                backgroundColor: palette.card,
                borderColor: visualMeta.accentHex,
              }}
              className="p-2.5 rounded-lg border-2 flex items-center justify-center shadow-sm"
            >
              <WhitelistedIcon name={mainIcon} size={compact ? 22 : 26} />
            </div>
            <span className="text-xs font-bold opacity-50">×</span>
            <div
              style={{
                backgroundColor: palette.card,
                borderColor: palette.border,
              }}
              className="p-2 rounded-lg border flex items-center justify-center shadow-sm"
            >
              <WhitelistedIcon name={subIcon} size={compact ? 20 : 24} />
            </div>
            <span className="text-xs font-bold opacity-50">＋</span>
            <div
              style={{
                backgroundColor: palette.card,
                borderColor: palette.border,
              }}
              className="p-2 rounded-lg border flex items-center justify-center opacity-90"
            >
              <WhitelistedIcon
                name={visualMeta.thirdIcon}
                size={compact ? 18 : 22}
              />
            </div>
          </div>

          {!allEnglishMode && (
            <div
              style={{
                backgroundColor: palette.card,
                borderColor: visualMeta.accentHex,
              }}
              className="px-2.5 py-1 rounded-md border text-xs font-extrabold shadow-sm shrink-0"
            >
              {situationTag}
            </div>
          )}
        </div>
      </div>

      {/* 下段：場面タグ（場所／相手／状況）＋回答後の場面解説 */}
      {!allEnglishMode ? (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
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
              状況：{situationTag}
            </span>
          </div>

          {showSituationMeaning && (
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
              <p className="text-sm font-bold leading-snug">
                {situationMeaning}
              </p>
            </div>
          )}
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
