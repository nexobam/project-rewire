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
import { spotIdiomAnchor } from '../domain/idiomSpotter';
import { calculateSttMatch } from '../domain/sttMatcher';
import {
  startAuxiliaryStt,
  type SttSessionController,
} from '../services/sttService';
import type { Chunk, Rating } from '../types';

export interface PostAnswerCardProps {
  chunk: Chunk;
  rating: Rating;
  isCorrect?: boolean;
  judgeReason?: string;
  userAnswerText?: string;
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
  isCorrect,
  judgeReason,
  userAnswerText,
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
  const [confirmingReport, setConfirmingReport] = useState(false);
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
      className="border-2 rounded-lg p-5 space-y-4 animate-pop-in"
      data-testid="post-answer-card"
    >
      {/* 評価ヘッダー（正誤＋色と秒数で表示・要件2-1-3） */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {typeof isCorrect === 'boolean' && (
              <span
                style={{
                  backgroundColor: isCorrect
                    ? (palette.greenText ?? palette.text)
                    : (palette.crimsonText ?? palette.text),
                  color: palette.background === '#141416' ? '#141416' : '#FFFFFF',
                }}
                className="px-2.5 py-0.5 rounded font-bold text-xs"
                data-testid="post-answer-correctness"
              >
                {isCorrect ? '○ 正解' : '× 不正解'}
              </span>
            )}
            <div
              style={{ color: ratingColor }}
              className="flex items-center gap-1.5 font-bold text-base"
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
          </div>

          <div className="text-[11px] font-mono opacity-75 flex items-center gap-2.5">
            {reactionMs !== null &&
              completionMs !== null &&
              reactionMs !== completionMs && <span>初動 {reactionSec}</span>}
            <span>完了 {completionSec}</span>
          </div>
        </div>

        {judgeReason && (
          <p
            className="text-xs opacity-85 font-medium"
            data-testid="post-answer-judge-reason"
          >
            {judgeReason}
          </p>
        )}

        {userAnswerText && (
          <div
            style={{
              backgroundColor: palette.background,
              borderColor:
                isCorrect === false
                  ? (palette.crimsonText ?? palette.border)
                  : palette.border,
            }}
            className="px-2.5 py-1.5 rounded border text-xs flex flex-wrap items-center gap-1.5"
            data-testid="post-answer-user-choice"
          >
            <span className="font-bold opacity-75">あなたの選択:</span>
            <span className="font-semibold">{userAnswerText}</span>
          </div>
        )}
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
          onPointerDown={(e) => {
            try {
              e.currentTarget.setPointerCapture?.(e.pointerId);
            } catch {
              // 無視
            }
            handlePracticeMicPointerDown();
          }}
          onPointerUp={handlePracticeMicPointerUp}
          onPointerCancel={handlePracticeMicPointerUp}
          onLostPointerCapture={handlePracticeMicPointerUp}
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
          className="w-full min-h-[48px] px-3 py-2 rounded-lg border font-bold text-xs flex items-center justify-center gap-2 tactile-block select-none no-touch-callout"
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
              発音チェック: &ldquo;{practiceTranscript}&rdquo;（一致率{' '}
              {Math.round((practiceMatchRate ?? 0) * 100)}%）
            </p>
          </div>
        )}
      </div>

      {/* 場面での意味・英語の語順チャンク理解・慣用句の英語脳リンク・発音フォーム */}
      {(() => {
        const idiomAnchor = spotIdiomAnchor(chunk.enText);
        if (allEnglishMode) {
          return idiomAnchor ? (
            <div
              style={{
                backgroundColor: palette.background,
                borderColor: palette.border,
              }}
              className="p-3 rounded border text-xs space-y-1"
              data-testid="explanation-idiom-anchor"
            >
              <p className="font-bold opacity-75">
                Chunk &amp; Easy English Paraphrase
              </p>
              <p className="font-mono font-bold text-sm">
                [{idiomAnchor.chunkPhrase}] {idiomAnchor.easyEnglish}
              </p>
            </div>
          ) : null;
        }
        return (
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

            {idiomAnchor && (
              <div
                style={{
                  backgroundColor: palette.background,
                  borderColor: palette.amberText ?? palette.border,
                }}
                className="p-3 rounded border space-y-1.5"
                data-testid="explanation-idiom-anchor"
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="text-xs font-bold opacity-80">
                    キー構文・熟語の英語脳リンク（塊チャンク ⇔ 簡単英語）
                  </span>
                  <span className="font-mono font-extrabold text-xs px-2 py-0.5 rounded border">
                    [{idiomAnchor.chunkPhrase}] {idiomAnchor.easyEnglish}
                  </span>
                </div>
                <p className="text-xs leading-relaxed opacity-90">
                  {idiomAnchor.spatialImageJa}
                </p>
                {idiomAnchor.examples && idiomAnchor.examples.length > 0 && (
                  <div
                    style={{ borderColor: palette.border }}
                    className="pt-1.5 mt-1 border-t space-y-1 text-xs"
                  >
                    <p className="font-bold opacity-75 text-[11px]">
                      同じ塊を使った応用例文:
                    </p>
                    <ul className="list-disc pl-4 space-y-0.5 opacity-90">
                      {idiomAnchor.examples.map((ex, idx) => (
                        <li key={idx}>{ex}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

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
        );
      })()}

      {/* アクションフッター：「不自然」報告ボタン＆次の問題へ */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <button
          type="button"
          disabled={reported}
          onClick={() => {
            if (!confirmingReport) {
              setConfirmingReport(true);
              return;
            }
            setReported(true);
            setConfirmingReport(false);
            onReportUnnatural(chunk.id);
          }}
          style={{ borderColor: palette.border }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium opacity-80 hover:opacity-100 disabled:opacity-40"
          data-testid="report-unnatural-button"
        >
          <Flag size={14} strokeWidth={1.75} color="currentColor" />
          <span>
            {reported
              ? '報告済み（以後出題しません）'
              : confirmingReport
                ? '本当に非表示にしますか？（再タップで確定）'
                : '不自然な問題として報告'}
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
