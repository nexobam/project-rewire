// 回答後カード（色と秒数の結果表示・英文全体開示・コアイメージ＆発音フォーム・「不自然」報告ボタン）

import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Flag,
  Volume2,
  XCircle,
} from 'lucide-react';
import type { ThemePalette } from '../domain/contrast';
import type { Chunk, Rating } from '../types';

export interface PostAnswerCardProps {
  chunk: Chunk;
  rating: Rating;
  reactionMs: number | null;
  completionMs: number | null;
  palette: ThemePalette;
  allEnglishMode?: boolean;
  sttTranscript?: string;
  sttMatchRate?: number;
  onReplayAudio: () => void;
  onNextQuestion: () => void;
  onReportUnnatural: (chunkId: string) => void;
}

export const PostAnswerCard: React.FC<PostAnswerCardProps> = ({
  chunk,
  rating,
  reactionMs,
  completionMs,
  palette,
  allEnglishMode = false,
  sttTranscript,
  sttMatchRate,
  onReplayAudio,
  onNextQuestion,
  onReportUnnatural,
}) => {
  const [reported, setReported] = useState(false);

  const ratingLabel =
    rating === 'green'
      ? '緑（瞬発クリア）'
      : rating === 'yellow'
        ? '黄（やや迷い）'
        : '赤（思考停止・弱点）';

  const ratingColor =
    rating === 'green'
      ? (palette.greenText ?? palette.text)
      : rating === 'yellow'
        ? (palette.amberText ?? palette.text)
        : (palette.crimsonText ?? palette.text);

  const reactionSec =
    reactionMs !== null ? `${(reactionMs / 1000).toFixed(2)}秒` : '―';
  const completionSec =
    completionMs !== null ? `${(completionMs / 1000).toFixed(2)}秒` : '―';

  return (
    <div
      style={{
        backgroundColor: palette.card,
        borderColor: ratingColor,
        color: palette.text,
      }}
      className="border-2 rounded-lg p-5 space-y-4"
      data-testid="post-answer-card"
    >
      {/* 評価ヘッダー（色と秒数で表示・要件2-1-3） */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          style={{ color: ratingColor }}
          className="flex items-center gap-2 font-bold text-base"
        >
          {rating === 'green' ? (
            <CheckCircle size={20} strokeWidth={1.75} color="currentColor" />
          ) : rating === 'yellow' ? (
            <AlertCircle size={20} strokeWidth={1.75} color="currentColor" />
          ) : (
            <XCircle size={20} strokeWidth={1.75} color="currentColor" />
          )}
          <span data-testid="post-answer-rating">{ratingLabel}</span>
        </div>

        <div className="text-xs font-mono flex items-center gap-3">
          <span>初動: {reactionSec}</span>
          <span>完了: {completionSec}</span>
        </div>
      </div>

      {/* 回答後に初めて英文全体を開示（要件2-1-2） */}
      <div
        style={{
          backgroundColor: palette.background,
          borderColor: palette.border,
        }}
        className="p-4 rounded-lg border flex items-center justify-between gap-3"
      >
        <p
          className="text-lg font-bold tracking-tight"
          data-testid="revealed-en-text"
        >
          {chunk.enText}
        </p>
        <button
          type="button"
          onClick={onReplayAudio}
          style={{ borderColor: palette.border }}
          className="p-2 rounded border tactile-btn shrink-0"
          aria-label="正解音声を再生"
        >
          <Volume2 size={18} strokeWidth={1.75} color="currentColor" />
        </button>
      </div>

      {/* STT補助結果がある場合のみ表示 */}
      {typeof sttTranscript === 'string' && sttTranscript.length > 0 && (
        <div
          style={{ borderColor: palette.border }}
          className="text-xs border rounded p-2.5 space-y-1"
        >
          <p className="font-semibold">
            STT認識補助: &ldquo;{sttTranscript}&rdquo;（一致率{' '}
            {Math.round((sttMatchRate ?? 0) * 100)}%）
          </p>
        </div>
      )}

      {/* コアイメージと発音フォーム（直訳禁止・要件2-1-4。Lv.4 All Englishモード時は非表示） */}
      {!allEnglishMode && (
        <div className="space-y-2 text-sm">
          <div
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
            }}
            className="p-3 rounded border"
          >
            <p className="text-xs font-bold opacity-75 mb-1">
              空間・動き・感情のコアイメージ（直訳なし）
            </p>
            <p>{chunk.coreImageJa}</p>
          </div>
          <div
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
            }}
            className="p-3 rounded border"
          >
            <p className="text-xs font-bold opacity-75 mb-1">
              発音フォーム（口・舌・リズム）
            </p>
            <p>{chunk.pronunciationTip}</p>
          </div>
        </div>
      )}

      {/* アクションフッター：「不自然」報告ボタン＆次の問題へ */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <button
          type="button"
          disabled={reported}
          onClick={() => {
            setReported(true);
            onReportUnnatural(chunk.id);
          }}
          style={{ borderColor: palette.border }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium opacity-80 hover:opacity-100 disabled:opacity-40"
          data-testid="report-unnatural-button"
        >
          <Flag size={14} strokeWidth={1.75} color="currentColor" />
          <span>
            {reported ? '報告済み（以後出題しません）' : '不自然な問題として報告'}
          </span>
        </button>

        <button
          type="button"
          onClick={onNextQuestion}
          style={{
            backgroundColor: palette.text,
            color: palette.card,
            borderColor: palette.text,
            borderBottomWidth: '3px',
          }}
          className="px-5 py-2.5 rounded-lg font-bold text-sm tactile-block"
          data-testid="next-question-button"
        >
          次の問題へ
        </button>
      </div>
    </div>
  );
};
