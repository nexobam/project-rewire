// Lv.0 初回レベル診断（3分・全15問：音変化と語順タップ、perTapMs中央値計測・設定画面からの再測定対応・要件2-1-3, 3）

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, Play, Volume2 } from 'lucide-react';
import { VisualCard } from '../components/VisualCard';
import { WordOrderBoard } from '../components/WordOrderBoard';
import { LV0_DIAGNOSIS_CHUNKS } from '../data/seed';
import type { ThemePalette } from '../domain/contrast';
import { shuffleArray, strictShuffleBlocks } from '../domain/shuffle';
import { calculateMedianPerTapMs } from '../domain/timingJudge';
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

  const lastTapTimeRef = useRef<number | null>(null);
  const preparedIndexRef = useRef<number | null>(null);
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

  const advanceOrFinish = useCallback(
    (updatedIntervals: number[]) => {
      const nextIdx = currentIndex + 1;
      if (nextIdx >= questions.length) {
        const median = calculateMedianPerTapMs(updatedIntervals);
        setFinishedPerTapMs(median);
      } else {
        // iOS Safariのタップコンテキスト内で次問題の音声を同期的に再生するため直接準備する
        preparedIndexRef.current = nextIdx;
        prepareQuestion(nextIdx);
        setCurrentIndex(nextIdx);
      }
    },
    [currentIndex, prepareQuestion, questions.length]
  );

  const handleSelectBlock = (block: Block) => {
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
      // 1問完了
      advanceOrFinish(updatedIntervals);
    }
  };

  const handleUndoBlock = (blockId?: string) => {
    playTactileClick(clickSound);
    if (!blockId) {
      setSelectedBlockIds((prev) => prev.slice(0, -1));
    } else {
      setSelectedBlockIds((prev) => prev.filter((id) => id !== blockId));
    }
  };

  const handleSoundChangeChoice = (_choiceText: string) => {
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
    advanceOrFinish(updatedIntervals);
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
              ? 'タップ速度（perTapMs）の再測定'
              : 'Lv.0 初回レベル診断（約3分・全15問）'}
          </h1>
          <p className="text-sm opacity-90">
            音変化の聞き取り（5問）と語順ブロックタップ（10問）を通じて、あなたの指のタップ間隔の中央値（
            <code>perTapMs</code>：350〜700ms）を測定し、専用タイムリミットとLv.1の出題順を設定します。
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
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div
          style={{
            backgroundColor: palette.card,
            borderColor: palette.border,
            color: palette.text,
          }}
          className="border rounded-xl p-6 space-y-4 text-center"
          data-testid="diagnosis-complete-card"
        >
          <div className="flex justify-center">
            <CheckCircle size={36} strokeWidth={1.75} color="currentColor" />
          </div>
          <h2 className="text-xl font-bold">診断完了！</h2>
          <p className="text-sm">
            測定されたあなたの基準タップ速度（<code>perTapMs</code>）：
            <strong className="text-lg font-mono ml-1">
              {finishedPerTapMs} ms
            </strong>
          </p>
          <p className="text-xs opacity-80">
            この速度をもとに、語順ブロックの動的タイムリミット（
            <code>perTapMs × ブロック数 + 800ms</code>）が最適化されました。
          </p>
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

      <VisualCard chunk={currentChunk} palette={palette} />

      {isSoundChangeStep ? (
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
