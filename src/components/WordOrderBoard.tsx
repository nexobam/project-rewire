// 語順ブロックボード（レイアウトシフト完全防止プレースホルダー・下辺3pxボーダー・translateY(2px)・最小高56px・間隔12px・PCキーボード1〜9/Backspace/Space対応）

import React from 'react';
import { RotateCcw, Volume2 } from 'lucide-react';
import type { ThemePalette } from '../domain/contrast';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import type { Block } from '../types';

export interface WordOrderBoardProps {
  shuffledBlocks: Block[];
  selectedBlockIds: string[];
  palette: ThemePalette;
  isAudioPlaying: boolean;
  onSelectBlock: (block: Block) => void;
  onUndoBlock: (blockId?: string) => void;
  onReplay: () => void;
}

export const WordOrderBoard: React.FC<WordOrderBoardProps> = ({
  shuffledBlocks,
  selectedBlockIds,
  palette,
  isAudioPlaying,
  onSelectBlock,
  onUndoBlock,
  onReplay,
}) => {
  const selectedSet = new Set(selectedBlockIds);
  const blockMap = new Map(shuffledBlocks.map((b) => [b.id, b]));
  const selectedBlocks = selectedBlockIds
    .map((id) => blockMap.get(id))
    .filter((b): b is Block => Boolean(b));

  // キーボード操作：1〜9（ブロック選択）、Backspace（1つ戻す）、Space（リプレイ）
  useKeyboardShortcuts({
    enabled: !isAudioPlaying,
    onSelectNumber: (idx) => {
      const target = shuffledBlocks[idx];
      if (target && !selectedSet.has(target.id)) {
        onSelectBlock(target);
      }
    },
    onBackspace: () => {
      if (selectedBlockIds.length > 0) {
        onUndoBlock();
      }
    },
    onReplay: () => {
      onReplay();
    },
  });

  return (
    <div className="space-y-4">
      {/* 上段：組み立て中の語順スロット（高さ固定 h-[168px] で折り返し時も下段の位置を1pxもずらさない） */}
      <div
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-lg p-3.5 h-[168px] overflow-y-auto flex flex-wrap content-start items-start gap-2.5"
        data-testid="assembled-slots"
      >
        {selectedBlocks.length === 0 ? (
          <span className="text-sm opacity-60 self-center my-auto w-full text-center">
            {isAudioPlaying
              ? '音声を聴いています...'
              : '聴こえた英語の語順のままブロックをタップ（または数字キー 1〜9）'}
          </span>
        ) : (
          selectedBlocks.map((block) => (
            <button
              key={`selected_${block.id}`}
              type="button"
              onClick={() => onUndoBlock(block.id)}
              style={{
                backgroundColor: palette.background,
                borderColor: palette.text,
                borderBottomWidth: '3px',
                color: palette.text,
              }}
              className="min-h-[44px] px-3 py-1.5 rounded-lg border font-semibold text-sm tactile-block flex items-center justify-center"
              data-testid={`selected-block-${block.id}`}
            >
              <span>{block.text}</span>
            </button>
          ))
        )}
      </div>

      {/* 操作バー：リプレイ（Space）＆1つ戻す（Backspace） */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onReplay}
          style={{
            backgroundColor: palette.card,
            borderColor: palette.border,
            borderBottomWidth: '3px',
            color: palette.text,
          }}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg border text-xs font-semibold tactile-block"
          data-testid="replay-audio-button"
        >
          <Volume2 size={16} strokeWidth={1.75} color="currentColor" />
          <span>もう一度聴く (Space)</span>
        </button>

        <button
          type="button"
          onClick={() => onUndoBlock()}
          disabled={selectedBlockIds.length === 0 || isAudioPlaying}
          style={{
            backgroundColor: palette.card,
            borderColor: palette.border,
            borderBottomWidth: '3px',
            color: palette.text,
          }}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-xs font-semibold tactile-block disabled:opacity-40"
          data-testid="undo-block-button"
        >
          <RotateCcw size={15} strokeWidth={1.75} color="currentColor" />
          <span>1つ戻す (Backspace)</span>
        </button>
      </div>

      {/* 下段：選択肢プール（音声再生中は非表示、移動後は同一サイズの半透明プレースホルダーを残して1pxもずらさない） */}
      {isAudioPlaying ? (
        <div
          style={{
            backgroundColor: palette.card,
            borderColor: palette.border,
            color: palette.text,
          }}
          className="border rounded-lg p-6 text-center text-sm font-medium min-h-[140px] flex items-center justify-center"
          data-testid="audio-playing-mask"
        >
          <span>音声再生中（再生完了後に選択肢が表示されます）</span>
        </div>
      ) : (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 gap-3"
          style={{ gap: '12px' }}
          data-testid="word-block-pool"
        >
          {shuffledBlocks.map((block, index) => {
            const isMoved = selectedSet.has(block.id);

            return (
              <div
                key={block.id}
                className="relative min-h-[56px]"
                data-testid={`pool-slot-${block.id}`}
              >
                {isMoved ? (
                  /* 元の位置に同じサイズの半透明プレースホルダーを残し、他のボタンの位置を1pxもずらさない（要件7） */
                  <div
                    aria-hidden="true"
                    style={{
                      borderColor: palette.border,
                      borderBottomWidth: '3px',
                    }}
                    className="w-full h-full min-h-[56px] px-4 py-2 rounded-lg border border-dashed opacity-30 flex items-center justify-between select-none pointer-events-none"
                    data-testid={`placeholder-block-${block.id}`}
                  >
                    <span className="text-xs font-mono opacity-0">
                      {index + 1}
                    </span>
                    <span className="font-semibold text-base opacity-0">
                      {block.text}
                    </span>
                    <span className="w-3" />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectBlock(block)}
                    style={{
                      backgroundColor: palette.card,
                      borderColor: palette.border,
                      borderBottomWidth: '3px',
                      color: palette.text,
                    }}
                    className="w-full h-full min-h-[56px] px-4 py-2 rounded-lg border font-semibold text-base tactile-block flex items-center justify-between"
                    data-testid={`choice-block-${block.id}`}
                  >
                    <span className="text-xs font-mono opacity-50 mr-1.5 shrink-0">
                      {index + 1}
                    </span>
                    <span className="break-words text-center leading-snug">
                      {block.text}
                    </span>
                    <span className="w-2 shrink-0" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
