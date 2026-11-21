// 回答後カード（色と秒数の結果表示・英文全体開示・場面の意図＆語順チャンク解説＆発音フォーム・Push-to-Talk発音練習マイク・「不自然」報告ボタン）

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Flag,
  Mic,
  Volume2,
  XCircle,
} from 'lucide-react';
import {
  extractSituationMeaning,
  extractWordOrderBreakdown,
} from '../domain/chunkExplanation';
import type { ThemePalette } from '../domain/contrast';
import { calculateSttMatch } from '../domain/sttMatcher';
import {
  startAuxiliaryStt,
  type SttSessionController,
} from '../services/sttService';
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
  const [practiceMicActive, setPracticeMicActive] = useState(false);
  const [practiceTranscript, setPracticeTranscript] = useState(
    sttTranscript ?? ''
  );
  const [practiceMatchRate, setPracticeMatchRate] = useState<
    number | undefined
  >(sttMatchRate);

  const sttControllerRef = useRef<SttSessionController | null>(null);
  const pressStartMsRef = useRef<number>(0);

  useEffect(() => {
    setPracticeTranscript(sttTranscript ?? '');
    setPracticeMatchRate(sttMatchRate);
    return () => {
      sttControllerRef.current?.stop();
    };
  }, [chunk.id, sttMatchRate, sttTranscript]);

  const startPracticeMic = useCallback(() => {
    sttControllerRef.current?.stop();
    setPracticeTranscript('');
    setPracticeMatchRate(undefined);
    setPracticeMicActive(true);
    pressStartMsRef.current = performance.now();

    sttControllerRef.current = startAuxiliaryStt({
      level: chunk.level || 1,
      disableSilenceTimeout: true,
      onTranscriptUpdate: (text) => {
        setPracticeTranscript(text);
        const match = calculateSttMatch(chunk.enText, text);
        setPracticeMatchRate(match.matchRate);
      },
      onFinish: (finalText) => {
        setPracticeMicActive(false);
        if (finalText) {
          setPracticeTranscript(finalText);
          const match = calculateSttMatch(chunk.enText, finalText);
          setPracticeMatchRate(match.matchRate);
        }
      },
      onFallbackToSelfJudge: () => {
        setPracticeMicActive(false);
      },
    });
  }, [chunk.enText, chunk.level]);

  const stopPracticeMic = useCallback(() => {
    sttControllerRef.current?.stop();
    setPracticeMicActive(false);
  }, []);

  const handlePracticeMicPointerDown = () => {
    if (practiceMicActive) {
      stopPracticeMic();
    } else {
      startPracticeMic();
    }
  };

  const handlePracticeMicPointerUp = () => {
    if (!practiceMicActive) return;
    const heldMs = performance.now() - pressStartMsRef.current;
    if (heldMs >= 350) {
      stopPracticeMic();
    }
  };

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

  const situationMeaning = extractSituationMeaning(chunk);
  const wordOrderBreakdown = extractWordOrderBreakdown(chunk);

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
          className="px-3 py-2 rounded border tactile-btn shrink-0 flex items-center gap-1.5 text-xs font-bold"
          aria-label="正解音声を再生"
          data-testid="post-answer-replay-audio"
        >
          <Volume2 size={18} strokeWidth={1.75} color="currentColor" />
          <span>お手本音声</span>
        </button>
      </div>

      {/* 回答後でも押している間マイク起動で声に出して練習できるボタン */}
      <div
        style={{
          backgroundColor: palette.background,
          borderColor: practiceMicActive
            ? (palette.amberSurface ?? palette.text)
            : palette.border,
        }}
        className="p-3 rounded-lg border space-y-2"
      >
        <button
          type="button"
          onPointerDown={handlePracticeMicPointerDown}
          onPointerUp={handlePracticeMicPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            backgroundColor: practiceMicActive
              ? (palette.amberSurface ?? palette.text)
              : palette.card,
            color: practiceMicActive
              ? (palette.amberSurfaceText ?? '#1C1917')
              : palette.text,
            borderColor: palette.text,
            borderBottomWidth: '3px',
            touchAction: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
          className="w-full min-h-[48px] px-3 py-2 rounded-lg border font-bold text-xs flex items-center justify-center gap-2 tactile-block select-none"
          data-testid="post-answer-mic-button"
        >
          <Mic size={16} strokeWidth={1.75} color="currentColor" />
          <span>
            {practiceMicActive
              ? 'マイク聞き取り中...（離す／タップで停止）'
              : 'ボタンを押している間（またはタップで）正解フレーズを声に出して練習'}
          </span>
        </button>

        {practiceTranscript.length > 0 && (
          <div className="text-xs space-y-0.5 pt-1">
            <p className="font-semibold">
              STT認識補助: &ldquo;{practiceTranscript}&rdquo;（一致率{' '}
              {Math.round((practiceMatchRate ?? 0) * 100)}%）
            </p>
          </div>
        )}
      </div>

      {/* 場面での意味・英語の語順チャンク理解・発音フォーム（Lv.4 All Englishモード時は非表示） */}
      {!allEnglishMode && (
        <div className="space-y-2 text-sm" data-testid="post-answer-explanation">
          <div
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
            }}
            className="p-3 rounded border"
            data-testid="explanation-situation-meaning"
          >
            <p className="text-xs font-bold opacity-75 mb-1">
              このセリフで言っていること（場面の意図）
            </p>
            <p className="font-bold text-base">{situationMeaning}</p>
          </div>

          <div
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
            }}
            className="p-3 rounded border"
            data-testid="explanation-word-order"
          >
            <p className="text-xs font-bold opacity-75 mb-1">
              英語の語順のまま前から理解（チャンク分解・コアイメージ）
            </p>
            <p>{wordOrderBreakdown}</p>
          </div>

          <div
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
            }}
            className="p-3 rounded border"
            data-testid="explanation-pronunciation"
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
          onClick={() => {
            sttControllerRef.current?.stop();
            onNextQuestion();
          }}
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
