// サイレントモード画面（3/15/30/60分・Lv.1前半絵カード4択／後半語順ブロック・音変化・2回目以降の高速復習＆連続多聴・即時スコア表示・要件2, 4-1, 5）

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Award, CheckCircle, Headphones, Volume2 } from 'lucide-react';
import { PostAnswerCard } from '../components/PostAnswerCard';
import { VisualCard } from '../components/VisualCard';
import { WordOrderBoard } from '../components/WordOrderBoard';
import {
  extractSituationMeaning,
  extractWordOrderBreakdown,
} from '../domain/chunkExplanation';
import type { ThemePalette } from '../domain/contrast';
import type { GateStatus } from '../domain/promotionGate';
import { buildSessionBatch } from '../domain/scheduler';
import { shuffleArray, strictShuffleBlocks } from '../domain/shuffle';
import {
  isAcceptableWordOrder,
  judgePictureChoiceTiming,
  judgeWordOrderTiming,
} from '../domain/timingJudge';
import {
  playTactileClick,
  startAmbientNoise,
  stopAmbientNoise,
  unlockAudioContext,
} from '../services/audioService';
import {
  speakEnglishText,
  unlockSpeechSynthesis,
} from '../services/ttsService';
import type {
  Attempt,
  Block,
  Chunk,
  ExerciseType,
  Rating,
  ReviewState,
  Session,
  Settings,
} from '../types';

export interface SilentModePageProps {
  plannedMinutes: number;
  isRehab?: boolean;
  isSecondOrLaterToday: boolean;
  settings: Settings;
  allChunks: Chunk[];
  reviewStates: ReviewState[];
  recentAttempts: Attempt[];
  currentStudyDate: string;
  gateStatus: GateStatus;
  palette: ThemePalette;
  onRecordAttempt: (params: {
    attempt: Attempt;
    session: Session;
    updateSrs?: boolean;
  }) => Promise<void>;
  onCompleteSession: (session: Session) => Promise<void>;
  onReportUnnatural: (chunkId: string) => void;
  onExitHome: () => void;
}

export const SilentModePage: React.FC<SilentModePageProps> = ({
  plannedMinutes,
  isRehab = false,
  isSecondOrLaterToday,
  settings,
  allChunks,
  reviewStates,
  recentAttempts,
  currentStudyDate,
  gateStatus,
  palette,
  onRecordAttempt,
  onCompleteSession,
  onReportUnnatural,
  onExitHome,
}) => {
  const [session] = useState<Session>(() => ({
    id: `sess_${Date.now()}`,
    mode: isRehab ? 'rehab' : 'silent',
    plannedMinutes,
    activeSeconds: 0,
    studyDate: currentStudyDate,
    startedAt: Date.now(),
  }));

  const [batch, setBatch] = useState<Chunk[]>(() =>
    buildSessionBatch({
      allChunks,
      reviewStates,
      recentAttempts,
      currentStudyDate,
      currentLevel: settings.level,
      mode: isRehab ? 'rehab' : 'silent',
    })
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [batchGeneration, setBatchGeneration] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(true);
  const [shuffledBlocks, setShuffledBlocks] = useState<Block[]>([]);
  const [shuffledSoundChoices, setShuffledSoundChoices] = useState<string[]>(
    []
  );
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [pictureChoices, setPictureChoices] = useState<Chunk[]>([]);
  const [replayBeforeShown, setReplayBeforeShown] = useState(0);
  const [replayAfterShown, setReplayAfterShown] = useState(0);

  // 回答後の結果表示ステート
  const [answeredResult, setAnsweredResult] = useState<{
    rating: Rating;
    reactionMs: number | null;
    completionMs: number | null;
  } | null>(null);

  // セッション全体のスコア集計（即時スコア表示用・要件5）
  const [sessionResults, setSessionResults] = useState<Rating[]>([]);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [sessionFinished, setSessionFinished] = useState(false);

  const shownTimestampRef = useRef<number>(performance.now());
  const firstTapMsRef = useRef<number | null>(null);
  const sessionStartMsRef = useRef<number>(Date.now());
  const hasshownChoicesRef = useRef<boolean>(false);
  // バックグラウンド同期や設定更新で現在の問題や回答後解説がリセットされないためのガード
  const preparedQuestionKeyRef = useRef<string | null>(null);

  const currentChunk = batch[currentIndex];

  // 出題形式の決定
  // - Lv.1前半（lv1Phase === 'picture'）：絵カード4択（picture_choice）
  // - 5問に1問は音変化リスニング（sound_change）、またはLv.2以降の2回目以降は連続多聴（listening_long）も含む
  // - それ以外：語順ブロック（word_order）
  const getExerciseType = useCallback(
    (idx: number, chunk: Chunk): ExerciseType => {
      if (
        isSecondOrLaterToday &&
        settings.level >= 2 &&
        idx % 5 === 4
      ) {
        return 'listening_long';
      }
      if (idx % 5 === 3 && chunk.hasSoundChange && chunk.soundChangeChoices) {
        return 'sound_change';
      }
      if (settings.level === 1 && settings.lv1Phase === 'picture') {
        return 'picture_choice';
      }
      return 'word_order';
    },
    [isSecondOrLaterToday, settings.level, settings.lv1Phase]
  );

  const exerciseType = currentChunk
    ? getExerciseType(currentIndex, currentChunk)
    : 'word_order';

  // Lv.3以降はWeb Audio APIによる背景ノイズを生成（要件3, 6-10）
  useEffect(() => {
    unlockSpeechSynthesis();
    unlockAudioContext();
    if (settings.level === 3) {
      startAmbientNoise();
    }
    return () => {
      stopAmbientNoise();
    };
  }, [settings.level]);

  // 問題セットアップと音声再生（再生中は選択肢を非表示にし、再生が終わった瞬間に0msで計測開始・要件2-1-2, 2-1-3）
  const startQuestion = useCallback(
    (chunk: Chunk) => {
      setAnsweredResult(null);
      setSelectedBlockIds([]);
      setReplayBeforeShown(0);
      setReplayAfterShown(0);
      firstTapMsRef.current = null;
      hasshownChoicesRef.current = false;
      setIsAudioPlaying(true);

      setShuffledBlocks(
        strictShuffleBlocks(chunk.blocks, chunk.acceptableOrders)
      );

      const baseSoundChoices =
        chunk.soundChangeChoices && chunk.soundChangeChoices.includes(chunk.enText)
          ? chunk.soundChangeChoices
          : [
              chunk.enText,
              'I am going to check it later.',
              'Let us talk about that tomorrow.',
              'That sounds totally fine with me.',
            ];
      setShuffledSoundChoices(shuffleArray(baseSoundChoices));

      // 絵カード4択用のダミー選択肢3枚（場面の意味も異なるもの）＋正解1枚をランダムに混ぜて作成
      const targetMeaning = extractSituationMeaning(chunk);
      const distractors = shuffleArray(
        allChunks.filter(
          (c) =>
            c.id !== chunk.id &&
            !c.disabled &&
            c.enText !== chunk.enText &&
            extractSituationMeaning(c) !== targetMeaning
        )
      ).slice(0, 3);
      const fourCards = shuffleArray([...distractors, chunk]);
      setPictureChoices(fourCards);

      void speakEnglishText({
        text: chunk.enText,
        rate: settings.ttsRate,
        multiSpeakerRandom: settings.level >= 2,
        onEnd: () => {
          setIsAudioPlaying(false);
          hasshownChoicesRef.current = true;
          shownTimestampRef.current = performance.now();
        },
      });
    },
    [allChunks, settings.level, settings.ttsRate]
  );

  const currentQuestionKey = currentChunk
    ? `${session.id}_b${batchGeneration}_q${currentIndex}_${currentChunk.id}`
    : null;

  useEffect(() => {
    if (
      currentChunk &&
      !sessionFinished &&
      currentQuestionKey &&
      preparedQuestionKeyRef.current !== currentQuestionKey
    ) {
      preparedQuestionKeyRef.current = currentQuestionKey;
      startQuestion(currentChunk);
    }
  }, [currentChunk, currentQuestionKey, sessionFinished, startQuestion]);

  // 轟音リプレイ救済（要件2-1-3）
  // - 選択肢表示前のリプレイ：1回までペナルティなし
  // - 選択肢表示後のリプレイ：タイマーをリセットし、最高評価は黄まで
  const handleReplay = useCallback(() => {
    if (!currentChunk) return;
    playTactileClick(settings.clickSound);
    if (!hasshownChoicesRef.current || isAudioPlaying) {
      setReplayBeforeShown((prev) => prev + 1);
    } else {
      setReplayAfterShown((prev) => prev + 1);
    }
    setIsAudioPlaying(true);
    firstTapMsRef.current = null;
    setSelectedBlockIds([]);

    void speakEnglishText({
      text: currentChunk.enText,
      rate: settings.ttsRate,
      multiSpeakerRandom: settings.level >= 2,
      onEnd: () => {
        setIsAudioPlaying(false);
        hasshownChoicesRef.current = true;
        shownTimestampRef.current = performance.now();
      },
    });
  }, [
    currentChunk,
    isAudioPlaying,
    settings.clickSound,
    settings.level,
    settings.ttsRate,
  ]);

  const submitAnswer = async (params: {
    rating: Rating;
    reactionMs: number | null;
    completionMs: number | null;
    missType?: 'sound_change' | 'order_delay';
  }) => {
    const { rating, reactionMs, completionMs, missType } = params;
    setAnsweredResult({ rating, reactionMs, completionMs });

    const nextResults = [...sessionResults, rating];
    setSessionResults(nextResults);
    if (rating === 'green') {
      const nextCombo = combo + 1;
      setCombo(nextCombo);
      setMaxCombo((prev) => Math.max(prev, nextCombo));
    } else {
      setCombo(0);
    }

    const elapsedSeconds = Math.max(
      1,
      Math.round((Date.now() - sessionStartMsRef.current) / 1000)
    );
    const updatedSession: Session = {
      ...session,
      activeSeconds: elapsedSeconds,
    };

    const attempt: Attempt = {
      id: `att_${Date.now()}_${currentIndex}`,
      chunkId: currentChunk.id,
      sessionId: session.id,
      exerciseType,
      studyDate: currentStudyDate,
      startedAt: Date.now(),
      reactionMs,
      completionMs,
      replayBeforeShown,
      replayAfterShown,
      rating,
      missType,
      inputMode: 'silent',
      selfJudged: false,
    };

    await onRecordAttempt({
      attempt,
      session: updatedSession,
      updateSrs: true,
    });
  };

  // 語順ブロックのタップ処理
  const handleSelectWordBlock = (block: Block) => {
    if (answeredResult || isAudioPlaying) return;
    playTactileClick(settings.clickSound);

    const now = performance.now();
    if (firstTapMsRef.current === null) {
      firstTapMsRef.current = Math.max(
        0,
        Math.round(now - shownTimestampRef.current)
      );
    }

    const nextSelected = [...selectedBlockIds, block.id];
    setSelectedBlockIds(nextSelected);

    if (nextSelected.length === currentChunk.blocks.length) {
      const completionMs = Math.max(
        1,
        Math.round(now - shownTimestampRef.current)
      );
      const reactionMs = firstTapMsRef.current ?? completionMs;

      const blockMap = new Map(currentChunk.blocks.map((b) => [b.id, b.text]));
      const userOrder = nextSelected.map((id) => blockMap.get(id) ?? '');
      const isCorrect = isAcceptableWordOrder(
        userOrder,
        currentChunk.acceptableOrders
      );

      const judged = judgeWordOrderTiming({
        isCorrect,
        reactionMs,
        completionMs,
        blockCount: currentChunk.blocks.length,
        perTapMs: settings.perTapMs,
        replayBeforeShown,
        replayAfterShown,
      });

      void submitAnswer({
        rating: judged.rating,
        reactionMs,
        completionMs,
        missType: judged.missType,
      });
    }
  };

  const handleUndoWordBlock = (blockId?: string) => {
    if (answeredResult || isAudioPlaying) return;
    playTactileClick(settings.clickSound);
    if (!blockId) {
      setSelectedBlockIds((prev) => prev.slice(0, -1));
    } else {
      setSelectedBlockIds((prev) => prev.filter((id) => id !== blockId));
    }
  };

  // 絵カード4択のタップ処理（Lv.1前半）
  const handleSelectPictureCard = (chosenCard: Chunk) => {
    if (answeredResult || isAudioPlaying) return;
    playTactileClick(settings.clickSound);
    const completionMs = Math.max(
      1,
      Math.round(performance.now() - shownTimestampRef.current)
    );
    const isCorrect = chosenCard.id === currentChunk.id;
    const judged = judgePictureChoiceTiming({
      isCorrect,
      completionMs,
      replayBeforeShown,
      replayAfterShown,
      isSoundChange: false,
    });

    void submitAnswer({
      rating: judged.rating,
      reactionMs: completionMs,
      completionMs,
      missType: judged.missType,
    });
  };

  // 音変化リスニング／連続多聴の4択タップ処理
  const handleSelectSoundChoice = (choiceText: string) => {
    if (answeredResult || isAudioPlaying) return;
    playTactileClick(settings.clickSound);
    const completionMs = Math.max(
      1,
      Math.round(performance.now() - shownTimestampRef.current)
    );
    const isCorrect = choiceText === currentChunk.enText;
    const judged = judgePictureChoiceTiming({
      isCorrect,
      completionMs,
      replayBeforeShown,
      replayAfterShown,
      isSoundChange: true,
    });

    void submitAnswer({
      rating: judged.rating,
      reactionMs: completionMs,
      completionMs,
      missType: judged.missType,
    });
  };

  // 次の問題へ進む（指定時間を過ぎていれば解いているこの問題でセッション終了・15問使い切ったら新バッチ補充・要件4）
  const handleNextQuestion = async () => {
    const elapsedMinutes =
      (Date.now() - sessionStartMsRef.current) / (60 * 1000);
    if (elapsedMinutes >= plannedMinutes) {
      const finalSession: Session = {
        ...session,
        activeSeconds: Math.max(
          60,
          Math.round((Date.now() - sessionStartMsRef.current) / 1000)
        ),
        endedAt: Date.now(),
      };
      setSessionFinished(true);
      await onCompleteSession(finalSession);
      return;
    }

    if (currentIndex + 1 < batch.length) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      // 15問バッチ完了：まだ残り時間がある場合は次バッチを補充
      const nextBatch = buildSessionBatch({
        allChunks,
        reviewStates,
        recentAttempts,
        currentStudyDate,
        currentLevel: settings.level,
        mode: isRehab ? 'rehab' : 'silent',
      });
      setBatch(nextBatch);
      setBatchGeneration((prev) => prev + 1);
      setCurrentIndex(0);
    }
  };

  const handleFinishSessionEarly = async () => {
    const finalSession: Session = {
      ...session,
      activeSeconds: Math.max(
        60,
        Math.round((Date.now() - sessionStartMsRef.current) / 1000)
      ),
      endedAt: Date.now(),
    };
    setSessionFinished(true);
    await onCompleteSession(finalSession);
  };

  // セッション終了時の即時スコア表示（スコア・緑の割合・コンボ・ゲートの進捗・要件5）
  if (sessionFinished) {
    const totalAnswered = Math.max(1, sessionResults.length);
    const greenCount = sessionResults.filter((r) => r === 'green').length;
    const yellowCount = sessionResults.filter((r) => r === 'yellow').length;
    const greenPercent = Math.round((greenCount / totalAnswered) * 100);
    const scorePoints = greenCount * 100 + yellowCount * 60;

    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div
          style={{
            backgroundColor: palette.card,
            borderColor: palette.border,
            color: palette.text,
          }}
          className="border rounded-xl p-6 space-y-5"
          data-testid="session-summary-card"
        >
          <div className="flex items-center gap-2 font-bold text-xl">
            <Award size={24} strokeWidth={1.75} color="currentColor" />
            <span>セッション完了（即時スコア）</span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div
              style={{
                backgroundColor: palette.background,
                borderColor: palette.border,
              }}
              className="p-3 rounded-lg border"
            >
              <div className="text-xs opacity-75">スコア</div>
              <div className="text-xl font-bold font-mono">{scorePoints}</div>
            </div>
            <div
              style={{
                backgroundColor: palette.background,
                borderColor: palette.border,
              }}
              className="p-3 rounded-lg border"
            >
              <div className="text-xs opacity-75">緑の割合</div>
              <div
                style={{ color: palette.greenText ?? palette.text }}
                className="text-xl font-bold font-mono"
              >
                {greenPercent}%
              </div>
            </div>
            <div
              style={{
                backgroundColor: palette.background,
                borderColor: palette.border,
              }}
              className="p-3 rounded-lg border"
            >
              <div className="text-xs opacity-75">最大コンボ</div>
              <div className="text-xl font-bold font-mono">{maxCombo}</div>
            </div>
          </div>

          <div
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
            }}
            className="p-4 rounded-lg border space-y-1 text-xs"
          >
            <p className="font-bold">昇格ゲートの現在進捗</p>
            <p>
              ① コアセット達成: {gateStatus.coreMastered}/{gateStatus.coreTotal}{' '}
              ({Math.round(gateStatus.coreRate * 100)}%)
            </p>
            <p>
              ② リスニング直近40問: {Math.round(gateStatus.listeningRate * 100)}%
            </p>
            <p>
              ③ 発話直近40回緑: {Math.round(gateStatus.speakingGreenRate * 100)}%
            </p>
            <p className="pt-1 opacity-75 flex items-center gap-1">
              <CheckCircle size={13} strokeWidth={1.75} color="currentColor" />
              <span>
                専属AI講師による弱点分析と新規問題生成をバックグラウンドで実行中です。
              </span>
            </p>
          </div>

          <button
            type="button"
            onClick={onExitHome}
            style={{
              backgroundColor: palette.text,
              color: palette.card,
              borderColor: palette.text,
              borderBottomWidth: '3px',
            }}
            className="w-full min-h-[56px] py-3 rounded-lg font-bold text-base tactile-block"
            data-testid="back-to-home-button"
          >
            ホームへ戻る
          </button>
        </div>
      </div>
    );
  }

  // Lv.2以降では音声と文字の同時表示を解禁（Lv.1は回答後まで英文非表示・要件2-1-2, 3）
  const allowSimultaneousSubtitle = settings.level >= 2;
  const isAllEnglish =
    settings.level === 4 && Boolean(settings.allEnglishMode);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      {/* 上部バー（回答中はタイマーも残り時間も表示しない・要件2-1-3） */}
      <div className="flex items-center justify-between text-xs font-semibold">
        <div className="flex items-center gap-2">
          <Headphones size={16} strokeWidth={1.75} color="currentColor" />
          <span>
            {isRehab
              ? '3分リハビリ'
              : isSecondOrLaterToday
                ? `サイレント高速復習 (${plannedMinutes}分枠)`
                : `サイレントモード (${plannedMinutes}分枠)`}
          </span>
          <span>
            / バッチ {currentIndex + 1} / {batch.length}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span>緑コンボ: {combo}</span>
          <button
            type="button"
            onClick={handleFinishSessionEarly}
            style={{ borderColor: palette.border }}
            className="px-2.5 py-1 rounded border text-xs"
            data-testid="finish-session-button"
          >
            終了して集計
          </button>
        </div>
      </div>

      {/* PCでは2カラム表示（左：状況ビジュアルカード＋場面解説、右：インタラクション／回答後カード） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-3">
          {exerciseType === 'picture_choice' && !answeredResult ? (
            <div
              style={{
                backgroundColor: palette.card,
                borderColor: palette.border,
              }}
              className="border rounded-lg p-5 space-y-3"
              data-testid="silent-picture-choice-guide"
            >
              <p className="text-sm font-bold">
                Lv.1前半（絵カード期）：流れた英語の音を聴き、その英語が言っている状況・意味に合うカードを4枚から1枚選んでください。
              </p>
              <p className="text-xs opacity-80">
                ※各カードには「場所・相手・感情」と「この場面で言っていること」が記載されています。選択後に正解の英文・語順チャンク解説・発音フォームが表示されます。
              </p>
              <button
                type="button"
                onClick={handleReplay}
                style={{
                  borderColor: palette.border,
                  borderBottomWidth: '3px',
                }}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg border text-xs font-semibold tactile-block"
              >
                <Volume2 size={16} strokeWidth={1.75} color="currentColor" />
                <span>もう一度聴く (Space)</span>
              </button>
            </div>
          ) : (
            <VisualCard
              chunk={currentChunk}
              palette={palette}
              allEnglishMode={isAllEnglish}
              showSituationMeaning={Boolean(answeredResult)}
              showEnglishSubtitle={
                allowSimultaneousSubtitle || Boolean(answeredResult)
              }
            />
          )}

          {/* サイレントモード左カラムにも回答後の語順チャンク解説サマリーを表示（スマホ・PCどちらでも一目で解説が見えるようにする） */}
          {answeredResult && !isAllEnglish && (
            <div
              style={{
                backgroundColor: palette.card,
                borderColor: palette.border,
              }}
              className="border rounded-lg p-4 space-y-2 text-xs"
              data-testid="silent-left-explanation-summary"
            >
              <p className="font-bold">
                サイレントモード解説（英語の語順のまま理解）
              </p>
              <p className="font-semibold text-sm">
                {extractSituationMeaning(currentChunk)}
              </p>
              <p className="opacity-90">
                {extractWordOrderBreakdown(currentChunk)}
              </p>
            </div>
          )}
        </div>

        <div>
          {answeredResult ? (
            <PostAnswerCard
              chunk={currentChunk}
              rating={answeredResult.rating}
              reactionMs={answeredResult.reactionMs}
              completionMs={answeredResult.completionMs}
              palette={palette}
              allEnglishMode={isAllEnglish}
              onReplayAudio={() => {
                void speakEnglishText({
                  text: currentChunk.enText,
                  rate: settings.ttsRate,
                });
              }}
              onNextQuestion={handleNextQuestion}
              onReportUnnatural={onReportUnnatural}
            />
          ) : exerciseType === 'picture_choice' ? (
            isAudioPlaying ? (
              <div
                style={{
                  backgroundColor: palette.card,
                  borderColor: palette.border,
                }}
                className="border rounded-lg p-6 text-center text-sm min-h-[160px] flex items-center justify-center"
                data-testid="audio-playing-mask"
              >
                音声再生中（再生完了後に4枚の状況カードが表示されます）
              </div>
            ) : (
              <div
                className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                data-testid="picture-choice-grid"
              >
                {pictureChoices.map((card) => (
                  <VisualCard
                    key={card.id}
                    chunk={card}
                    palette={palette}
                    compact
                    showSituationMeaning={true}
                    showEnglishSubtitle={false}
                    onClick={() => handleSelectPictureCard(card)}
                  />
                ))}
              </div>
            )
          ) : exerciseType === 'sound_change' ||
            exerciseType === 'listening_long' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold">
                  {exerciseType === 'listening_long'
                    ? '連続多聴リスニング：聴こえた内容に合致するチャンクを選択'
                    : '音変化リスニング：聴こえた英語を選択'}
                </span>
                <button
                  type="button"
                  onClick={handleReplay}
                  style={{ borderColor: palette.border }}
                  className="flex items-center gap-1 px-3 py-1.5 rounded border text-xs font-semibold"
                >
                  <Volume2 size={14} strokeWidth={1.75} color="currentColor" />
                  <span>もう一度聴く</span>
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
                  音声再生中...
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {shuffledSoundChoices.map((choice, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectSoundChoice(choice)}
                      style={{
                        backgroundColor: palette.card,
                        borderColor: palette.border,
                        borderBottomWidth: '3px',
                        color: palette.text,
                      }}
                      className="min-h-[56px] px-4 py-3 rounded-lg border text-left font-semibold text-sm tactile-block"
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <WordOrderBoard
              shuffledBlocks={shuffledBlocks}
              selectedBlockIds={selectedBlockIds}
              palette={palette}
              isAudioPlaying={isAudioPlaying}
              onSelectBlock={handleSelectWordBlock}
              onUndoBlock={handleUndoWordBlock}
              onReplay={handleReplay}
            />
          )}
        </div>
      </div>
    </div>
  );
};
