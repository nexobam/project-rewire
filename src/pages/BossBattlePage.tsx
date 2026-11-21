// ボス戦画面（全10問・ヒントなし・黄以内で正解した問題が8問以上で合格＆次Lv昇格、不合格時は24時間クールダウン＆間違いをSRS最優先登録・要件3）

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Award, CheckCircle, Mic, Shield, XCircle } from 'lucide-react';
import { WordOrderBoard } from '../components/WordOrderBoard';
import { extractSituationMeaning } from '../domain/chunkExplanation';
import type { ThemePalette } from '../domain/contrast';
import {
  buildBossQuestions,
  evaluateBossBattle,
  type BossQuestion,
} from '../domain/promotionGate';
import { shuffleArray, strictShuffleBlocks } from '../domain/shuffle';
import { calculateSttMatch } from '../domain/sttMatcher';
import {
  isAcceptableWordOrder,
  judgePictureChoiceTiming,
  judgeWordOrderTiming,
} from '../domain/timingJudge';
import { playTactileClick, unlockAudioContext } from '../services/audioService';
import {
  startAuxiliaryStt,
  type SttSessionController,
} from '../services/sttService';
import {
  speakEnglishText,
  unlockSpeechSynthesis,
} from '../services/ttsService';
import type {
  Attempt,
  Block,
  Chunk,
  Level,
  Rating,
  Session,
  Settings,
} from '../types';

export interface BossBattlePageProps {
  settings: Settings;
  allChunks: Chunk[];
  currentStudyDate: string;
  palette: ThemePalette;
  onRecordAttempt: (params: {
    attempt: Attempt;
    session: Session;
    updateSrs?: boolean;
  }) => Promise<void>;
  onPassBoss: (nextLevel: Level) => Promise<void>;
  onFailBoss: (cooldownUntil: number) => Promise<void>;
  onExitHome: () => void;
}

export const BossBattlePage: React.FC<BossBattlePageProps> = ({
  settings,
  allChunks,
  currentStudyDate,
  palette,
  onRecordAttempt,
  onPassBoss,
  onFailBoss,
  onExitHome,
}) => {
  const [questions] = useState<BossQuestion[]>(() =>
    buildBossQuestions(settings.level, allChunks)
  );
  const [session] = useState<Session>(() => ({
    id: `sess_boss_${Date.now()}`,
    mode: 'boss',
    plannedMinutes: 10,
    activeSeconds: 0,
    studyDate: currentStudyDate,
    startedAt: Date.now(),
  }));

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(true);
  const [shuffledBlocks, setShuffledBlocks] = useState<Block[]>([]);
  const [shuffledSoundChoices, setShuffledSoundChoices] = useState<string[]>(
    []
  );
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [sttActive, setSttActive] = useState(false);
  const [sttTranscript, setSttTranscript] = useState('');
  const [results, setResults] = useState<{ chunkId: string; rating: Rating }[]>(
    []
  );
  const [finalOutcome, setFinalOutcome] = useState<{
    passed: boolean;
    correctCount: number;
  } | null>(null);

  const shownTimestampRef = useRef<number>(performance.now());
  const firstTapMsRef = useRef<number | null>(null);
  const sessionStartMsRef = useRef<number>(Date.now());
  const preparedQuestionKeyRef = useRef<string | null>(null);
  const sttControllerRef = useRef<SttSessionController | null>(null);
  const micPressStartMsRef = useRef<number>(0);

  const currentQ = questions[currentIndex];

  const startQuestion = useCallback(
    (q: BossQuestion) => {
      sttControllerRef.current?.stop();
      setSttActive(false);
      setSttTranscript('');
      setSelectedBlockIds([]);
      firstTapMsRef.current = null;
      setShuffledBlocks(
        strictShuffleBlocks(q.chunk.blocks, q.chunk.acceptableOrders)
      );
      const baseSoundChoices =
        q.chunk.soundChangeChoices &&
        q.chunk.soundChangeChoices.includes(q.chunk.enText)
          ? q.chunk.soundChangeChoices
          : [
              q.chunk.enText,
              'Let us check that schedule later.',
              'I am going to head back soon.',
              'That sounds completely fine to me.',
            ];
      setShuffledSoundChoices(shuffleArray(baseSoundChoices));

      if (q.exerciseType === 'speak') {
        setIsAudioPlaying(false);
        shownTimestampRef.current = performance.now();
        return;
      }

      setIsAudioPlaying(true);
      void speakEnglishText({
        text: q.chunk.enText,
        rate: settings.ttsRate,
        multiSpeakerRandom: settings.level >= 2,
        onEnd: () => {
          setIsAudioPlaying(false);
          shownTimestampRef.current = performance.now();
        },
      });
    },
    [settings.level, settings.ttsRate]
  );

  useEffect(() => {
    unlockSpeechSynthesis();
    unlockAudioContext();
    return () => {
      sttControllerRef.current?.stop();
    };
  }, []);

  const currentQuestionKey = currentQ
    ? `${session.id}_q${currentIndex}_${currentQ.chunk.id}`
    : null;

  useEffect(() => {
    if (
      currentQ &&
      !finalOutcome &&
      currentQuestionKey &&
      preparedQuestionKeyRef.current !== currentQuestionKey
    ) {
      preparedQuestionKeyRef.current = currentQuestionKey;
      startQuestion(currentQ);
    }
  }, [currentQ, currentQuestionKey, finalOutcome, startQuestion]);

  const startBossMic = useCallback(() => {
    if (!currentQ) return;
    playTactileClick(settings.clickSound);
    sttControllerRef.current?.stop();
    setSttTranscript('');
    setSttActive(true);
    micPressStartMsRef.current = performance.now();

    sttControllerRef.current = startAuxiliaryStt({
      level: settings.level,
      disableSilenceTimeout: true,
      onTranscriptUpdate: (text) => {
        setSttTranscript(text);
        calculateSttMatch(currentQ.chunk.enText, text);
      },
      onFinish: (finalText) => {
        setSttActive(false);
        if (finalText) {
          setSttTranscript(finalText);
        }
      },
      onFallbackToSelfJudge: () => {
        setSttActive(false);
      },
    });
  }, [currentQ, settings.clickSound, settings.level]);

  const stopBossMic = useCallback(() => {
    playTactileClick(settings.clickSound);
    sttControllerRef.current?.stop();
    setSttActive(false);
  }, [settings.clickSound]);

  const handleBossMicPointerDown = () => {
    if (sttActive) {
      stopBossMic();
    } else {
      startBossMic();
    }
  };

  const handleBossMicPointerUp = () => {
    if (!sttActive) return;
    const heldMs = performance.now() - micPressStartMsRef.current;
    if (heldMs >= 350) {
      stopBossMic();
    }
  };

  const recordAndAdvance = async (rating: Rating) => {
    sttControllerRef.current?.stop();
    setSttActive(false);
    const nextResults = [...results, { chunkId: currentQ.chunk.id, rating }];
    setResults(nextResults);

    const elapsedSeconds = Math.max(
      1,
      Math.round((Date.now() - sessionStartMsRef.current) / 1000)
    );
    const updatedSession: Session = {
      ...session,
      activeSeconds: elapsedSeconds,
    };

    const attempt: Attempt = {
      id: `att_boss_${Date.now()}_${currentIndex}`,
      chunkId: currentQ.chunk.id,
      sessionId: session.id,
      exerciseType: currentQ.exerciseType,
      studyDate: currentStudyDate,
      startedAt: Date.now(),
      reactionMs: firstTapMsRef.current,
      completionMs: Math.round(performance.now() - shownTimestampRef.current),
      replayBeforeShown: 0,
      replayAfterShown: 0,
      rating,
      inputMode: currentQ.exerciseType === 'speak' ? 'voice' : 'silent',
      selfJudged: currentQ.exerciseType === 'speak',
      sttTranscript: sttTranscript || undefined,
    };

    // 間違えた問題（red）は updateReviewState により stage 0（最優先復習キュー）に戻る
    await onRecordAttempt({
      attempt,
      session: updatedSession,
      updateSrs: true,
    });

    if (currentIndex + 1 >= questions.length) {
      const outcome = evaluateBossBattle(nextResults);
      setFinalOutcome({
        passed: outcome.passed,
        correctCount: outcome.correctCount,
      });
      if (outcome.passed) {
        const nextLevel = Math.min(4, settings.level + 1) as Level;
        await onPassBoss(nextLevel);
      } else if (outcome.cooldownUntil) {
        await onFailBoss(outcome.cooldownUntil);
      }
    } else {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handleSelectChoice = (choiceText: string) => {
    if (isAudioPlaying) return;
    playTactileClick(settings.clickSound);
    const completionMs = Math.max(
      1,
      Math.round(performance.now() - shownTimestampRef.current)
    );
    const isCorrect = choiceText === currentQ.chunk.enText;
    const judged = judgePictureChoiceTiming({
      isCorrect,
      completionMs,
      isSoundChange: true,
    });
    void recordAndAdvance(judged.rating);
  };

  const handleSelectBlock = (block: Block) => {
    if (isAudioPlaying) return;
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

    if (nextSelected.length === currentQ.chunk.blocks.length) {
      const completionMs = Math.max(
        1,
        Math.round(now - shownTimestampRef.current)
      );
      const reactionMs = firstTapMsRef.current ?? completionMs;
      const blockMap = new Map(
        currentQ.chunk.blocks.map((b) => [b.id, b.text])
      );
      const userOrder = nextSelected.map((id) => blockMap.get(id) ?? '');
      const isCorrect = isAcceptableWordOrder(
        userOrder,
        currentQ.chunk.acceptableOrders
      );
      const judged = judgeWordOrderTiming({
        isCorrect,
        reactionMs,
        completionMs,
        blockCount: currentQ.chunk.blocks.length,
        perTapMs: settings.perTapMs,
      });
      void recordAndAdvance(judged.rating);
    }
  };

  const handleSelfJudgeSpeak = (rating: Rating) => {
    playTactileClick(settings.clickSound);
    void recordAndAdvance(rating);
  };

  if (finalOutcome) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div
          style={{
            backgroundColor: palette.card,
            borderColor: palette.border,
            color: palette.text,
          }}
          className="border rounded-xl p-6 space-y-4 text-center"
          data-testid="boss-outcome-card"
        >
          <div className="flex justify-center">
            {finalOutcome.passed ? (
              <Award size={42} strokeWidth={1.75} color="currentColor" />
            ) : (
              <XCircle size={42} strokeWidth={1.75} color="currentColor" />
            )}
          </div>
          <h2 className="text-xl font-bold">
            {finalOutcome.passed
              ? 'ボス戦合格！次のレベルへ昇格しました'
              : 'ボス戦不合格（24時間後に再挑戦可能）'}
          </h2>
          <p className="text-sm font-semibold">
            黄以内での正解数: {finalOutcome.correctCount} / {questions.length}問
            （合格基準: 8問以上）
          </p>
          {!finalOutcome.passed && (
            <p className="text-xs opacity-80">
              間違えた問題はSRSの最優先復習キューに登録されました。明日までに弱点を補強して再挑戦しましょう。
            </p>
          )}
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
          >
            ホームへ戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between text-xs font-bold">
        <div className="flex items-center gap-2">
          <Shield size={17} strokeWidth={1.75} color="currentColor" />
          <span>
            ボス戦（全10問・ヒントなし）: 問題 {currentIndex + 1} /{' '}
            {questions.length}
          </span>
        </div>
        <span>合格基準: 8問以上を黄以内でクリア</span>
      </div>

      {/* ボス戦はヒントなし（状況ビジュアルカードのタグヒントも出さず、音または発話ミッションで勝負・要件3） */}
      <div
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-xl p-5 space-y-4"
      >
        {currentQ.exerciseType === 'sound_change' ||
        currentQ.exerciseType === 'listening_long' ? (
          <div className="space-y-3">
            <p className="text-sm font-bold">
              【リスニング関門（ヒントなし）】聴こえた英文を選択してください
            </p>
            {isAudioPlaying ? (
              <div className="p-6 text-center text-sm">音声再生中...</div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {shuffledSoundChoices.map((choice, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectChoice(choice)}
                    style={{
                      backgroundColor: palette.background,
                      borderColor: palette.border,
                      borderBottomWidth: '3px',
                    }}
                    className="min-h-[56px] px-4 py-3 rounded-lg border text-left font-semibold text-sm tactile-block"
                    data-testid={`boss-choice-${idx}`}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : currentQ.exerciseType === 'word_order' ? (
          <div className="space-y-3">
            <p className="text-sm font-bold">
              【語順ブロック関門（ヒントなし）】聴こえた通りにブロックを並べてください
            </p>
            <WordOrderBoard
              shuffledBlocks={shuffledBlocks}
              selectedBlockIds={selectedBlockIds}
              palette={palette}
              isAudioPlaying={isAudioPlaying}
              onSelectBlock={handleSelectBlock}
              onUndoBlock={(id) => {
                if (!id) setSelectedBlockIds((prev) => prev.slice(0, -1));
                else
                  setSelectedBlockIds((prev) => prev.filter((x) => x !== id));
              }}
              onReplay={() => startQuestion(currentQ)}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm font-bold">
              【発話関門（ヒントなし）】以下の発話ミッションを2秒以内に英語で発話してください
            </p>
            <div
              style={{
                backgroundColor: palette.background,
                borderColor: palette.border,
              }}
              className="p-3.5 rounded-lg border font-bold text-base"
              data-testid="boss-speak-mission"
            >
              {extractSituationMeaning(currentQ.chunk)}
            </div>

            <button
              type="button"
              onPointerDown={handleBossMicPointerDown}
              onPointerUp={handleBossMicPointerUp}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                backgroundColor: sttActive
                  ? (palette.amberSurface ?? palette.text)
                  : palette.background,
                color: sttActive
                  ? (palette.amberSurfaceText ?? '#1C1917')
                  : palette.text,
                borderColor: palette.text,
                borderBottomWidth: '3px',
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
              className="w-full min-h-[52px] px-4 py-2.5 rounded-lg border-2 font-bold text-xs flex items-center justify-center gap-2 tactile-block select-none"
              data-testid="boss-push-to-talk-mic-button"
            >
              <Mic size={18} strokeWidth={1.75} color="currentColor" />
              <span>
                {sttActive
                  ? 'マイク聞き取り中...（離す／タップで停止）'
                  : 'マイクボタンを押している間（またはタップで）英語を話す'}
              </span>
            </button>

            {sttTranscript && (
              <p className="text-xs font-mono">&ldquo;{sttTranscript}&rdquo;</p>
            )}

            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => handleSelfJudgeSpeak('green')}
                style={{
                  borderColor: palette.greenText ?? palette.text,
                  borderBottomWidth: '3px',
                }}
                className="min-h-[56px] p-3 rounded-lg border-2 font-bold text-xs flex items-center justify-center gap-1 tactile-block"
                data-testid="boss-speak-green"
              >
                <CheckCircle size={15} strokeWidth={1.75} color="currentColor" />
                <span>2秒以内（緑）</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelfJudgeSpeak('yellow')}
                style={{
                  borderColor: palette.amberText ?? palette.text,
                  borderBottomWidth: '3px',
                }}
                className="min-h-[56px] p-3 rounded-lg border-2 font-bold text-xs flex items-center justify-center gap-1 tactile-block"
                data-testid="boss-speak-yellow"
              >
                <span>遅れた（黄）</span>
              </button>
              <button
                type="button"
                onClick={() => handleSelfJudgeSpeak('red')}
                style={{
                  borderColor: palette.crimsonText ?? palette.text,
                  borderBottomWidth: '3px',
                }}
                className="min-h-[56px] p-3 rounded-lg border-2 font-bold text-xs flex items-center justify-center gap-1 tactile-block"
                data-testid="boss-speak-red"
              >
                <span>言えず（赤）</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
