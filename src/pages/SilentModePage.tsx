// サイレントモード画面（3/15/30/60分・Lv.1前半絵カード4択／後半語順ブロック・音変化・2回目以降の高速復習＆連続多聴・即時スコア表示・要件2, 4-1, 5）

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Award, CheckCircle, Headphones, Volume2 } from 'lucide-react';
import { PostAnswerCard } from '../components/PostAnswerCard';
import { TimeLimitBar } from '../components/TimeLimitBar';
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
  calculateCompletionBudget,
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
  stopSpeechSynthesis,
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

  // 絵柄の問題（Lv.1前半：pictureフェーズ）は日常会話（daily）のみに絞り、バスケ（heat）を出題しない
  const isPicturePhase = settings.level === 1 && settings.lv1Phase === 'picture';
  const dailyOnlyChunks = allChunks.filter((c) => c.contentCategory === 'daily');
  const selectableChunksForBatch =
    isPicturePhase && dailyOnlyChunks.length > 0 ? dailyOnlyChunks : allChunks;

  const [batch, setBatch] = useState<Chunk[]>(() =>
    buildSessionBatch({
      allChunks: selectableChunksForBatch,
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
    isCorrect: boolean;
    judgeReason: string;
    reactionMs: number | null;
    completionMs: number | null;
  } | null>(null);

  // セッション全体のスコア集計（即時スコア表示用・要件5）
  const [sessionResults, setSessionResults] = useState<Rating[]>([]);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [sessionFinished, setSessionFinished] = useState(false);

  const [timerStartMs, setTimerStartMs] = useState<number>(() =>
    performance.now()
  );
  const shownTimestampRef = useRef<number>(performance.now());
  const firstTapMsRef = useRef<number | null>(null);
  const sessionStartMsRef = useRef<number>(Date.now());
  const pausedTotalMsRef = useRef<number>(0);
  const hiddenAtMsRef = useRef<number | null>(null);
  const submittingAnswerRef = useRef<boolean>(false);
  const navigatingNextRef = useRef<boolean>(false);
  const hasshownChoicesRef = useRef<boolean>(false);
  // バックグラウンド同期や設定更新で現在の問題や回答後解説がリセットされないためのガード
  const preparedQuestionKeyRef = useRef<string | null>(null);

  const currentChunk = batch[currentIndex];

  useEffect(() => {
    const onVisChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtMsRef.current = Date.now();
      } else if (document.visibilityState === 'visible' && hiddenAtMsRef.current !== null) {
        pausedTotalMsRef.current += Date.now() - hiddenAtMsRef.current;
        hiddenAtMsRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, []);

  const getActiveElapsedMs = () =>
    Math.max(0, Date.now() - sessionStartMsRef.current - pausedTotalMsRef.current);

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

  // Lv.3以降はWeb Audio APIによる背景ノイズを生成（音声アンロックは開始ボタンタップ時に実施済みのためここでは割り込ませない）
  useEffect(() => {
    unlockAudioContext();
    if (settings.level >= 3) {
      startAmbientNoise();
    }
    return () => {
      stopAmbientNoise();
    };
  }, [settings.level]);

  // コンポーネントのアンマウント時（StrictModeの再マウント含む）に再生状態をリセットし音声リークを防ぐ
  useEffect(() => {
    return () => {
      preparedQuestionKeyRef.current = null;
      stopSpeechSynthesis();
    };
  }, []);

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

      let baseSoundChoices: string[];
      if (
        chunk.soundChangeChoices &&
        chunk.soundChangeChoices.includes(chunk.enText)
      ) {
        baseSoundChoices = chunk.soundChangeChoices;
      } else {
        const distractors = allChunks
          .filter(
            (c) =>
              !c.disabled &&
              c.id !== chunk.id &&
              c.enText.trim().toLowerCase() !== chunk.enText.trim().toLowerCase()
          )
          .map((c) => c.enText);
        const fallbackDistractors = [
          'I am going to check it later.',
          'Let us talk about that tomorrow.',
          'That sounds totally fine with me.',
        ];
        const picked = shuffleArray(
          Array.from(new Set([...distractors, ...fallbackDistractors]))
        ).slice(0, 3);
        baseSoundChoices = [chunk.enText, ...picked];
      }
      setShuffledSoundChoices(shuffleArray(baseSoundChoices));

      // 絵カード4択用のダミー選択肢3枚（日常会話のみ・場面・場所タグ・アイコンが被らないカードを優先）＋正解1枚を作成
      const targetMeaning = extractSituationMeaning(chunk);
      const dailyCandidates = allChunks.filter(
        (c) =>
          c.id !== chunk.id &&
          !c.disabled &&
          c.contentCategory === 'daily' &&
          c.enText !== chunk.enText &&
          extractSituationMeaning(c) !== targetMeaning
      );
      const fallbackCandidates = allChunks.filter(
        (c) =>
          c.id !== chunk.id &&
          !c.disabled &&
          c.enText !== chunk.enText &&
          extractSituationMeaning(c) !== targetMeaning
      );
      const basePool = shuffleArray(
        dailyCandidates.length >= 3 ? dailyCandidates : fallbackCandidates
      );
      const pickedDistractors: Chunk[] = [];
      const usedPlaces = new Set<string>([chunk.visual.tags[0]]);
      const usedIcons = new Set<string>([chunk.visual.icons.join('|')]);

      // 第1優先：sceneCategory・場所タグ・アイコンペアすべてが異なるカードを選ぶ
      for (const cand of basePool) {
        if (pickedDistractors.length >= 3) break;
        const place = cand.visual.tags[0];
        const iconPair = cand.visual.icons.join('|');
        if (
          cand.sceneCategory !== chunk.sceneCategory &&
          !usedPlaces.has(place) &&
          !usedIcons.has(iconPair)
        ) {
          pickedDistractors.push(cand);
          usedPlaces.add(place);
          usedIcons.add(iconPair);
        }
      }
      // 第2優先：不足分は場所タグのみ重複しないカードで補充
      for (const cand of basePool) {
        if (pickedDistractors.length >= 3) break;
        if (pickedDistractors.some((d) => d.id === cand.id)) continue;
        const place = cand.visual.tags[0];
        if (!usedPlaces.has(place)) {
          pickedDistractors.push(cand);
          usedPlaces.add(place);
        }
      }
      // 第3優先：それでも3枚未満なら残りから補充
      for (const cand of basePool) {
        if (pickedDistractors.length >= 3) break;
        if (!pickedDistractors.some((d) => d.id === cand.id)) {
          pickedDistractors.push(cand);
        }
      }

      const fourCards = shuffleArray([...pickedDistractors, chunk]);
      setPictureChoices(fourCards);

      void speakEnglishText({
        text: chunk.enText,
        rate: settings.ttsRate,
        multiSpeakerRandom: settings.level >= 2,
        onEnd: () => {
          const now = performance.now();
          setIsAudioPlaying(false);
          hasshownChoicesRef.current = true;
          shownTimestampRef.current = now;
          setTimerStartMs(now);
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
        const now = performance.now();
        setIsAudioPlaying(false);
        hasshownChoicesRef.current = true;
        shownTimestampRef.current = now;
        setTimerStartMs(now);
      },
    });
  }, [
    currentChunk,
    isAudioPlaying,
    settings.clickSound,
    settings.level,
    settings.ttsRate,
  ]);

  const buildJudgeReasonText = (
    isCorrect: boolean,
    rating: Rating,
    beforeReplays: number,
    afterReplays: number
  ): string => {
    if (!isCorrect) {
      return '選んだ内容が正解と異なっていたため、赤判定になりました。';
    }
    if (rating === 'green') {
      return '正解！制限時間内に迷わず答えられたため、緑判定です。';
    }
    if (rating === 'yellow') {
      if (beforeReplays >= 2 || afterReplays >= 1) {
        return '正解！リプレイ（聴き直し）を使用したため、黄判定になりました。';
      }
      return '正解！少し時間がかかったため、黄判定になりました。';
    }
    return '正解ですが、制限時間を大きく超えたため、赤判定（要復習）になりました。';
  };

  const submitAnswer = async (params: {
    rating: Rating;
    isCorrect: boolean;
    judgeReason: string;
    reactionMs: number | null;
    completionMs: number | null;
    missType?: 'sound_change' | 'order_delay';
  }) => {
    if (submittingAnswerRef.current || answeredResult || !currentChunk) return;
    submittingAnswerRef.current = true;
    try {
      const { rating, isCorrect, judgeReason, reactionMs, completionMs, missType } =
        params;
      setAnsweredResult({
        rating,
        isCorrect,
        judgeReason,
        reactionMs,
        completionMs,
      });

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
        Math.round(getActiveElapsedMs() / 1000)
      );
      const updatedSession: Session = {
        ...session,
        activeSeconds: elapsedSeconds,
      };

      const attempt: Attempt = {
        id: `att_${Date.now()}_b${batchGeneration}_${currentIndex}_${Math.random().toString(36).slice(2, 6)}`,
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
    } finally {
      submittingAnswerRef.current = false;
    }
  };

  // 語順ブロックのタップ処理
  const handleSelectWordBlock = (block: Block) => {
    if (answeredResult || isAudioPlaying || selectedBlockIds.includes(block.id)) {
      return;
    }
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
        isCorrect,
        judgeReason: buildJudgeReasonText(
          isCorrect,
          judged.rating,
          replayBeforeShown,
          replayAfterShown
        ),
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
      isCorrect,
      judgeReason: buildJudgeReasonText(
        isCorrect,
        judged.rating,
        replayBeforeShown,
        replayAfterShown
      ),
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
      isCorrect,
      judgeReason: buildJudgeReasonText(
        isCorrect,
        judged.rating,
        replayBeforeShown,
        replayAfterShown
      ),
      reactionMs: completionMs,
      completionMs,
      missType: judged.missType,
    });
  };

  // 次の問題へ進む（指定時間を過ぎていれば解いているこの問題でセッション終了・15問使い切ったら新バッチ補充・要件4）
  const handleNextQuestion = async () => {
    if (navigatingNextRef.current) return;
    navigatingNextRef.current = true;
    stopSpeechSynthesis();
    try {
      const elapsedMinutes = getActiveElapsedMs() / (60 * 1000);
      if (elapsedMinutes >= plannedMinutes) {
        const finalSession: Session = {
          ...session,
          activeSeconds:
            sessionResults.length > 0
              ? Math.max(60, Math.round(getActiveElapsedMs() / 1000))
              : 0,
          endedAt: Date.now(),
        };
        setSessionFinished(true);
        await onCompleteSession(finalSession);
        return;
      }

      if (currentIndex + 1 < batch.length) {
        const nextIdx = currentIndex + 1;
        const nextChunk = batch[nextIdx];
        if (nextChunk) {
          // iOS Safariのタップコンテキスト内で次問題の音声を同期再生する
          preparedQuestionKeyRef.current = `${session.id}_b${batchGeneration}_q${nextIdx}_${nextChunk.id}`;
          startQuestion(nextChunk);
        }
        setCurrentIndex(nextIdx);
      } else {
        // 15問バッチ完了：まだ残り時間がある場合は次バッチを補充
        const nextBatch = buildSessionBatch({
          allChunks: selectableChunksForBatch,
          reviewStates,
          recentAttempts,
          currentStudyDate,
          currentLevel: settings.level,
          mode: isRehab ? 'rehab' : 'silent',
        });
        const nextGen = batchGeneration + 1;
        const firstNext = nextBatch[0];
        if (firstNext) {
          preparedQuestionKeyRef.current = `${session.id}_b${nextGen}_q0_${firstNext.id}`;
          startQuestion(firstNext);
        }
        setBatch(nextBatch);
        setBatchGeneration(nextGen);
        setCurrentIndex(0);
      }
    } finally {
      navigatingNextRef.current = false;
    }
  };

  const handleFinishSessionEarly = async () => {
    if (navigatingNextRef.current) return;
    navigatingNextRef.current = true;
    stopSpeechSynthesis();
    try {
      const finalSession: Session = {
        ...session,
        activeSeconds:
          sessionResults.length > 0
            ? Math.max(60, Math.round(getActiveElapsedMs() / 1000))
            : 0,
        endedAt: Date.now(),
      };
      setSessionFinished(true);
      await onCompleteSession(finalSession);
    } finally {
      navigatingNextRef.current = false;
    }
  };

  if (!currentChunk && !sessionFinished) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div
          style={{
            backgroundColor: palette.card,
            borderColor: palette.border,
            color: palette.text,
          }}
          className="border rounded-xl p-6 space-y-4 text-center"
        >
          <p className="font-bold">現在、出題できる問題がありません。</p>
          <button
            type="button"
            onClick={onExitHome}
            style={{
              backgroundColor: palette.text,
              color: palette.card,
              borderColor: palette.text,
            }}
            className="px-5 py-2.5 rounded-lg font-bold text-sm"
          >
            ホームへ戻る
          </button>
        </div>
      </div>
    );
  }

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
          className="border rounded-xl p-6 space-y-5 animate-pop-in"
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

  const isAllEnglish =
    settings.level === 4 && Boolean(settings.allEnglishMode);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      {/* 上部バー＋進捗プログレスバー */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold">
          <div className="flex items-center gap-2">
            <Headphones size={16} strokeWidth={1.75} color="currentColor" />
            <span>
              {isRehab
                ? '3分リハビリ'
                : isSecondOrLaterToday
                  ? `サイレント復習 (${plannedMinutes}分)`
                  : `サイレント (${plannedMinutes}分)`}
            </span>
            <span className="font-mono opacity-80">
              {currentIndex + 1} / {batch.length}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span
              key={combo}
              style={{
                borderColor: combo >= 2 ? (palette.greenText ?? palette.text) : palette.border,
                color: combo >= 2 ? (palette.greenText ?? palette.text) : palette.text,
              }}
              className={`px-2 py-0.5 rounded border font-bold ${combo >= 1 ? 'animate-combo-bump' : ''}`}
            >
              連続クリア: {combo}
            </span>
            <button
              type="button"
              onClick={handleFinishSessionEarly}
              style={{ borderColor: palette.border }}
              className="px-2.5 py-1 rounded border text-xs"
              data-testid="finish-session-button"
            >
              ここで終了
            </button>
          </div>
        </div>

        <div
          style={{ backgroundColor: palette.border }}
          className="w-full h-1.5 rounded-full overflow-hidden"
        >
          <div
            style={{
              backgroundColor: palette.text,
              width: `${Math.round(((currentIndex + 1) / Math.max(1, batch.length)) * 100)}%`,
            }}
            className="h-full transition-all duration-300"
          />
        </div>
      </div>

      {/* リアルタイム制限時間進捗バー（緑→黄→赤の3ゾーン可視化） */}
      {(() => {
        const wordBudget = calculateCompletionBudget(
          settings.perTapMs,
          currentChunk.blocks.length
        );
        const greenLimitMs =
          exerciseType === 'picture_choice'
            ? 4500
            : exerciseType === 'sound_change' ||
                exerciseType === 'listening_long'
              ? 5500
              : wordBudget;
        const yellowLimitMs =
          exerciseType === 'picture_choice'
            ? 7000
            : exerciseType === 'sound_change' ||
                exerciseType === 'listening_long'
              ? 8500
              : wordBudget + 1500;
        return (
          <TimeLimitBar
            palette={palette}
            isAudioPlaying={isAudioPlaying}
            isAnswered={Boolean(answeredResult)}
            startTimeMs={timerStartMs}
            frozenElapsedMs={answeredResult?.completionMs ?? undefined}
            greenLimitMs={greenLimitMs}
            yellowLimitMs={yellowLimitMs}
            questionKey={currentQuestionKey ?? currentIndex}
            hasReplayPenalty={replayAfterShown > 0 || replayBeforeShown > 1}
          />
        );
      })()}

      {/* PCでは2カラム表示（左：状況ビジュアルカード＋場面解説、右：インタラクション／回答後カード） */}
      <div
        key={currentQuestionKey ?? currentIndex}
        className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start animate-card-enter"
      >
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
                Lv.1前半（絵カード期）：流れた英語の音を聴き、その場面に合う状況ビジュアルカード（場所・相手・感情）を4枚から1枚選んでください。
              </p>
              <p className="text-xs opacity-80">
                ※日本語のネタバレは出ません。選択後に正解の英文・言っていること・語順チャンク解説・発音フォームが表示されます。
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
              showCategoryBadge={Boolean(answeredResult)}
              showEnglishSubtitle={Boolean(answeredResult)}
            />
          )}

          {/* サイレントモード左カラム解説サマリー（PC幅のみ表示しモバイルでの二重表示を防止） */}
          {answeredResult && !isAllEnglish && (
            <div
              style={{
                backgroundColor: palette.card,
                borderColor: palette.border,
              }}
              className="hidden lg:block border rounded-lg p-4 space-y-2 text-xs"
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
              isCorrect={answeredResult.isCorrect}
              judgeReason={answeredResult.judgeReason}
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
            isAudioPlaying ||
            !pictureChoices.some((c) => c.id === currentChunk.id) ? (
              <div
                style={{
                  backgroundColor: palette.card,
                  borderColor: palette.border,
                }}
                className="border rounded-lg p-6 text-center text-sm min-h-[160px] flex flex-col items-center justify-center gap-3"
                data-testid="audio-playing-mask"
              >
                <div className="flex items-end gap-1.5 h-6" aria-hidden="true">
                  <span
                    style={{ backgroundColor: palette.text }}
                    className="w-1.5 h-6 rounded-full audio-wave-bar"
                  />
                  <span
                    style={{ backgroundColor: palette.text }}
                    className="w-1.5 h-6 rounded-full audio-wave-bar"
                  />
                  <span
                    style={{ backgroundColor: palette.text }}
                    className="w-1.5 h-6 rounded-full audio-wave-bar"
                  />
                </div>
                <span className="font-semibold">
                  音声再生中（聴き終わると4枚のカードが表示されます）
                </span>
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
                    showSituationMeaning={false}
                    showCategoryBadge={false}
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
              {isAudioPlaying ||
              !shuffledSoundChoices.includes(currentChunk.enText) ? (
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
