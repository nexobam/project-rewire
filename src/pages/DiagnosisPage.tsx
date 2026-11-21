// Lv.0 初回レベル診断（3分・全15問：音変化と語順タップ、perTapMs中央値計測・設定画面からの再測定対応・要件2-1-3, 3）

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, Play, Volume2, XCircle } from 'lucide-react';
import { VisualCard } from '../components/VisualCard';
import { WordOrderBoard } from '../components/WordOrderBoard';
import { LV0_DIAGNOSIS_CHUNKS } from '../data/seed';
import { extractSituationMeaning } from '../domain/chunkExplanation';
import type { ThemePalette } from '../domain/contrast';
import { shuffleArray, strictShuffleBlocks } from '../domain/shuffle';
import {
  calculateMedianPerTapMs,
  isAcceptableWordOrder,
} from '../domain/timingJudge';
import { playTactileClick, unlockAudioContext } from '../services/audioService';
import {
  speakEnglishText,
  stopSpeechSynthesis,
  unlockSpeechSynthesis,
} from '../services/ttsService';
import type { Block, Chunk } from '../types';

export interface DiagnosisPageProps {
  palette: ThemePalette;
  ttsRate: number;
  clickSound: boolean;
  isRecalibration?: boolean;
  onCompleteDiagnosis: (measuredPerTapMs: number) => void;
  onCancel?: () => void;
}

export const DiagnosisPage: React.FC<DiagnosisPageProps> = ({
  palette,
  ttsRate,
  clickSound,
  isRecalibration = false,
  onCompleteDiagnosis,
  onCancel,
}) => {
  const questions: Chunk[] = useMemo(
    () => LV0_DIAGNOSIS_CHUNKS.slice(0, 15),
    []
  );
  const [started, setStarted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [shuffledBlocks, setShuffledBlocks] = useState<Block[]>([]);
  const [shuffledSoundChoices, setShuffledSoundChoices] = useState<string[]>([]);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [tapIntervals, setTapIntervals] = useState<number[]>([]);
  const [finishedPerTapMs, setFinishedPerTapMs] = useState<number | null>(null);
  const [questionFeedback, setQuestionFeedback] = useState<{
    isCorrect: boolean;
    userText?: string;
  } | null>(null);
  const [listeningCorrect, setListeningCorrect] = useState(0);
  const [orderCorrect, setOrderCorrect] = useState(0);

  const lastTapTimeRef = useRef<number | null>(null);
  const preparedIndexRef = useRef<number | null>(null);
  const pendingIntervalsRef = useRef<number[]>([]);
  const currentChunk = questions[currentIndex];

  // 前半5問は音変化4択、後半10問は語順ブロックタップ（合計15問）
  const isSoundChangeStep = currentIndex < 5 && Boolean(currentChunk?.soundChangeChoices);

  const playQuestionAudio = useCallback(
    (chunk: Chunk) => {
      setIsAudioPlaying(true);
      void speakEnglishText({
        text: chunk.enText,
        rate: ttsRate,
        onEnd: () => {
          setIsAudioPlaying(false);
          lastTapTimeRef.current = performance.now();
        },
      });
    },
    [ttsRate]
  );

  const prepareQuestion = useCallback(
    (index: number) => {
      const chunk = questions[index];
      if (!chunk) return;
      setQuestionFeedback(null);
      setSelectedBlockIds([]);
      setShuffledBlocks(
        strictShuffleBlocks(chunk.blocks, chunk.acceptableOrders)
      );
      setShuffledSoundChoices(
        shuffleArray(chunk.soundChangeChoices ?? [chunk.enText])
      );
      playQuestionAudio(chunk);
    },
    [playQuestionAudio, questions]
  );

  useEffect(() => {
    return () => {
      stopSpeechSynthesis();
    };
  }, []);

  useEffect(() => {
    if (
      started &&
      finishedPerTapMs === null &&
      currentChunk &&
      preparedIndexRef.current !== currentIndex
    ) {
      preparedIndexRef.current = currentIndex;
      prepareQuestion(currentIndex);
    }
  }, [started, currentIndex, finishedPerTapMs, currentChunk, prepareQuestion]);

  const handleNextAfterFeedback = useCallback(() => {
    playTactileClick(clickSound);
    const nextIdx = currentIndex + 1;
    if (nextIdx >= questions.length) {
      stopSpeechSynthesis();
      const median = calculateMedianPerTapMs(pendingIntervalsRef.current);
      setFinishedPerTapMs(median);
    } else {
      // iOS Safariのタップコンテキスト内で次問題の音声を同期的に再生するため直接準備する
      preparedIndexRef.current = nextIdx;
      prepareQuestion(nextIdx);
      setCurrentIndex(nextIdx);
    }
  }, [clickSound, currentIndex, prepareQuestion, questions.length]);

  const handleSelectBlock = (block: Block) => {
    if (questionFeedback || isAudioPlaying) return;
    playTactileClick(clickSound);
    const now = performance.now();
    let updatedIntervals = tapIntervals;
    if (lastTapTimeRef.current !== null) {
      const delta = now - lastTapTimeRef.current;
      if (delta >= 80 && delta <= 3000) {
        updatedIntervals = [...tapIntervals, delta];
        setTapIntervals(updatedIntervals);
      }
    }
    lastTapTimeRef.current = now;

    const nextSelected = [...selectedBlockIds, block.id];
    setSelectedBlockIds(nextSelected);

    if (nextSelected.length === currentChunk.blocks.length) {
      const userOrder = nextSelected
        .map((id) => currentChunk.blocks.find((b) => b.id === id)?.text ?? '')
        .filter(Boolean);
      const isCorrect = isAcceptableWordOrder(
        userOrder,
        currentChunk.acceptableOrders
      );
      if (isCorrect) {
        setOrderCorrect((prev) => prev + 1);
      }
      pendingIntervalsRef.current = updatedIntervals;
      setQuestionFeedback({
        isCorrect,
        userText: userOrder.join(' '),
      });
    }
  };

  const handleUndoBlock = (blockId?: string) => {
    if (questionFeedback) return;
    playTactileClick(clickSound);
    if (!blockId) {
      setSelectedBlockIds((prev) => prev.slice(0, -1));
    } else {
      setSelectedBlockIds((prev) => prev.filter((id) => id !== blockId));
    }
  };

  const handleSoundChangeChoice = (choiceText: string) => {
    if (questionFeedback || isAudioPlaying) return;
    playTactileClick(clickSound);
    const now = performance.now();
    let updatedIntervals = tapIntervals;
    if (lastTapTimeRef.current !== null) {
      const delta = (now - lastTapTimeRef.current) / 2;
      if (delta >= 100 && delta <= 2500) {
        updatedIntervals = [...tapIntervals, delta];
        setTapIntervals(updatedIntervals);
      }
    }
    const isCorrect = choiceText === currentChunk.enText;
    if (isCorrect) {
      setListeningCorrect((prev) => prev + 1);
    }
    pendingIntervalsRef.current = updatedIntervals;
    setQuestionFeedback({
      isCorrect,
      userText: choiceText,
    });
  };

  if (!started) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div
          style={{
            backgroundColor: palette.card,
            borderColor: palette.border,
            color: palette.text,
          }}
          className="border rounded-xl p-6 space-y-4"
        >
          <h1 className="text-xl font-bold">
            {isRecalibration
              ? '操作スピードの再測定'
              : 'Lv.0 初回レベル診断（約3分・全15問）'}
          </h1>
          <p className="text-sm opacity-90 leading-relaxed">
            英語の聞き取り（5問）と語順の並べ替え（10問）に答えるだけで、あなたの理解の速さに合った「ちょうどいい制限時間」を自動で設定します。
          </p>
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                // 開始ボタンのタップイベント内で音声とAudioContextをアンロックし、1問目を同期的に開始（要件6-1・iOS Safari対策）
                unlockSpeechSynthesis();
                unlockAudioContext();
                playTactileClick(clickSound);
                preparedIndexRef.current = 0;
                prepareQuestion(0);
                setStarted(true);
              }}
              style={{
                backgroundColor: palette.amberSurface ?? palette.text,
                color: palette.amberSurfaceText ?? palette.card,
                borderColor: palette.text,
                borderBottomWidth: '3px',
              }}
              className="flex-1 min-h-[56px] px-5 py-3 rounded-lg border font-bold text-base flex items-center justify-center gap-2 tactile-block"
              data-testid="start-diagnosis-button"
            >
              <Play size={18} strokeWidth={1.75} color="currentColor" />
              <span>診断を開始する（全15問）</span>
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                style={{ borderColor: palette.border }}
                className="px-4 py-3 rounded-lg border text-sm font-semibold"
              >
                キャンセル
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (finishedPerTapMs !== null) {
    const totalCorrect = listeningCorrect + orderCorrect;
    const totalCount = questions.length;
    const accuracyPercent = Math.round((totalCorrect / Math.max(1, totalCount)) * 100);
    const speedType =
      finishedPerTapMs <= 430
        ? {
            label: '高速タイプ（テンポよく即答できるペース）',
            detail: '反応が速いため、キビキビ進める制限時間に設定しました。',
          }
        : finishedPerTapMs <= 570
          ? {
              label: '標準タイプ（バランスの良いペース）',
              detail: '焦りすぎず考えすぎない、標準の制限時間に設定しました。',
            }
          : {
              label: 'じっくりタイプ（丁寧・確実に進めるペース）',
              detail: '落ち着いて英語の語順を掴める、ゆとりのある制限時間に設定しました。',
            };

    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div
          style={{
            backgroundColor: palette.card,
            borderColor: palette.border,
            color: palette.text,
          }}
          className="border rounded-xl p-6 space-y-5 text-center"
          data-testid="diagnosis-complete-card"
        >
          <div className="flex justify-center">
            <CheckCircle size={36} strokeWidth={1.75} color="currentColor" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold">診断完了！</h2>
            <p className="text-xs opacity-75">
              あなた専用のトレーニング設定が完了しました
            </p>
          </div>

          <div
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
            }}
            className="p-4 rounded-lg border space-y-3 text-left text-sm"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">正答数</span>
              <span className="font-bold font-mono text-base" data-testid="diagnosis-score-summary">
                {totalCorrect} / {totalCount} 問正解（{accuracyPercent}%）
              </span>
            </div>
            <div className="text-xs opacity-80 flex items-center justify-between">
              <span>内訳</span>
              <span>
                聞き取り {listeningCorrect}/5問 ・ 語順 {orderCorrect}/10問
              </span>
            </div>
            <div
              style={{ borderColor: palette.border }}
              className="pt-2.5 border-t space-y-1"
            >
              <p className="text-xs font-bold opacity-75">あなたの反応ペース判定</p>
              <p className="font-bold text-sm" data-testid="diagnosis-speed-label">
                {speedType.label}
              </p>
              <p className="text-xs opacity-80">{speedType.detail}</p>
              <p className="text-[11px] font-mono opacity-60">
                （参考：1タップ基準 {finishedPerTapMs} ms）
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={completing}
            onClick={() => {
              if (completing) return;
              setCompleting(true);
              onCompleteDiagnosis(finishedPerTapMs);
            }}
            style={{
              backgroundColor: palette.text,
              color: palette.card,
              borderColor: palette.text,
              borderBottomWidth: '3px',
            }}
            className="w-full min-h-[56px] px-5 py-3 rounded-lg font-bold text-base tactile-block disabled:opacity-50"
            data-testid="finish-diagnosis-button"
          >
            {isRecalibration ? '設定を保存して戻る' : 'Lv.1 トレーニングへ進む'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span>
          Lv.0 診断: {currentIndex + 1} / {questions.length}
        </span>
        <span>
          {isSoundChangeStep ? '音変化リスニング' : '語順ブロック瞬発タップ'}
        </span>
      </div>

      <VisualCard
        chunk={currentChunk}
        palette={palette}
        showSituationMeaning={Boolean(questionFeedback)}
        showEnglishSubtitle={Boolean(questionFeedback)}
      />

      {questionFeedback ? (
        <div
          style={{
            backgroundColor: palette.card,
            borderColor: questionFeedback.isCorrect
              ? (palette.greenText ?? palette.border)
              : (palette.crimsonText ?? palette.border),
          }}
          className="border-2 rounded-xl p-5 space-y-3"
          data-testid="diagnosis-question-feedback"
        >
          <div
            style={{
              color: questionFeedback.isCorrect
                ? (palette.greenText ?? palette.text)
                : (palette.crimsonText ?? palette.text),
            }}
            className="flex items-center gap-2 font-bold text-base"
          >
            {questionFeedback.isCorrect ? (
              <CheckCircle size={20} strokeWidth={2} color="currentColor" />
            ) : (
              <XCircle size={20} strokeWidth={2} color="currentColor" />
            )}
            <span>
              {questionFeedback.isCorrect ? '正解！' : '不正解'}
            </span>
          </div>

          <div
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
            }}
            className="p-3 rounded-lg border space-y-1 text-sm"
          >
            <p className="text-xs opacity-75 font-semibold">正解の英語</p>
            <p className="font-bold">{currentChunk.enText}</p>
            <p className="text-xs opacity-85 pt-0.5">
              意味：{extractSituationMeaning(currentChunk)}
            </p>
            {!questionFeedback.isCorrect && questionFeedback.userText && (
              <p className="text-xs opacity-70 pt-1">
                あなたの回答：{questionFeedback.userText}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleNextAfterFeedback}
            style={{
              backgroundColor: palette.text,
              color: palette.card,
              borderColor: palette.text,
              borderBottomWidth: '3px',
            }}
            className="w-full min-h-[52px] px-5 py-3 rounded-lg font-bold text-sm tactile-block"
            data-testid="diagnosis-next-button"
          >
            {currentIndex + 1 >= questions.length
              ? '診断結果を見る'
              : '次の問題へ'}
          </button>
        </div>
      ) : isSoundChangeStep ? (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold">
              聴こえた音に最も近い文を1つ選択（再生完了後に表示）
            </span>
            <button
              type="button"
              onClick={() => playQuestionAudio(currentChunk)}
              style={{ borderColor: palette.border }}
              className="flex items-center gap-1 px-3 py-1.5 rounded border text-xs font-semibold"
            >
              <Volume2 size={14} strokeWidth={1.75} color="currentColor" />
              <span>リプレイ</span>
            </button>
          </div>
          {isAudioPlaying ? (
            <div
              style={{
                backgroundColor: palette.card,
                borderColor: palette.border,
              }}
              className="border rounded-lg p-6 text-center text-sm"
            >
              音声を再生中...
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {shuffledSoundChoices.map(
                (choice, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSoundChangeChoice(choice)}
                    style={{
                      backgroundColor: palette.card,
                      borderColor: palette.border,
                      borderBottomWidth: '3px',
                      color: palette.text,
                    }}
                    className="min-h-[56px] px-4 py-3 rounded-lg border text-left font-semibold text-sm tactile-block"
                    data-testid={`diagnosis-choice-${idx}`}
                  >
                    {choice}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ) : (
        <WordOrderBoard
          shuffledBlocks={shuffledBlocks}
          selectedBlockIds={selectedBlockIds}
          palette={palette}
          isAudioPlaying={isAudioPlaying}
          onSelectBlock={handleSelectBlock}
          onUndoBlock={handleUndoBlock}
          onReplay={() => playQuestionAudio(currentChunk)}
        />
      )}
    </div>
  );
};
