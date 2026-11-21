// 発話ドリルモード画面（5/15/30分・オウム返し禁止＝回答前はお手本音声なし・自己判定3ボタン＋Push-to-Talkマイク＆STT補助・Lv.3 NGワード対応・要件2-2, 4-2）

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Award,
  CheckCircle,
  Mic,
  Volume2,
  XCircle,
} from 'lucide-react';
import { PostAnswerCard } from '../components/PostAnswerCard';
import { VisualCard } from '../components/VisualCard';
import {
  extractSituationMeaning,
  extractWordOrderBreakdown,
} from '../domain/chunkExplanation';
import type { ThemePalette } from '../domain/contrast';
import type { GateStatus } from '../domain/promotionGate';
import { buildSessionBatch } from '../domain/scheduler';
import {
  calculateSttMatch,
  containsNgWord,
  resolveSpeechRating,
} from '../domain/sttMatcher';
import {
  playTactileClick,
  startAmbientNoise,
  stopAmbientNoise,
  unlockAudioContext,
} from '../services/audioService';
import {
  isSttSupported,
  startAuxiliaryStt,
  type SttSessionController,
} from '../services/sttService';
import {
  speakEnglishText,
  unlockSpeechSynthesis,
} from '../services/ttsService';
import type {
  Attempt,
  Chunk,
  ExerciseType,
  Rating,
  ReviewState,
  Session,
  Settings,
} from '../types';

export interface SpeakModePageProps {
  plannedMinutes: number;
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

export const SpeakModePage: React.FC<SpeakModePageProps> = ({
  plannedMinutes,
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
    id: `sess_speak_${Date.now()}`,
    mode: 'speak',
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
      mode: 'speak',
    })
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [batchGeneration, setBatchGeneration] = useState(0);
  const [sttTranscript, setSttTranscript] = useState('');
  const [sttMatchRate, setSttMatchRate] = useState<number | undefined>(
    undefined
  );
  const [sttActive, setSttActive] = useState(false);
  const [showFirstWordHint, setShowFirstWordHint] = useState(false);
  const [showSituationHint, setShowSituationHint] = useState(false);
  const [answeredResult, setAnsweredResult] = useState<{
    rating: Rating;
    completionMs: number;
  } | null>(null);
  const [sessionResults, setSessionResults] = useState<Rating[]>([]);
  const [sessionFinished, setSessionFinished] = useState(false);

  const sttControllerRef = useRef<SttSessionController | null>(null);
  const micPressStartMsRef = useRef<number>(0);
  const questionStartMsRef = useRef<number>(performance.now());
  const sessionStartMsRef = useRef<number>(Date.now());
  // バックグラウンド同期や設定更新で現在の問題や回答後解説がリセットされないためのガード
  const preparedQuestionKeyRef = useRef<string | null>(null);

  const currentChunk = batch[currentIndex];

  // レベルに応じた発話演習種別（Lv.1: speak, Lv.2: chunk_building, Lv.3+: paraphrase）
  const exerciseType: ExerciseType =
    settings.level === 2
      ? 'chunk_building'
      : settings.level >= 3
        ? 'paraphrase'
        : 'speak';

  useEffect(() => {
    unlockSpeechSynthesis();
    unlockAudioContext();
    if (settings.level === 3) {
      startAmbientNoise();
    }
    return () => {
      stopAmbientNoise();
      sttControllerRef.current?.stop();
    };
  }, [settings.level]);

  // 問題開始：オウム返し禁止（回答前はお手本音声を流さず、発話ミッション・答え・音声対象をすべて currentChunk.enText に統一して不一致を防ぐ）
  const startSpeakQuestion = useCallback(() => {
    sttControllerRef.current?.stop();
    setSttActive(false);
    setShowFirstWordHint(false);
    setShowSituationHint(false);
    setAnsweredResult(null);
    setSttTranscript('');
    setSttMatchRate(undefined);
    questionStartMsRef.current = performance.now();
  }, []);

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
      startSpeakQuestion();
    }
  }, [currentChunk, currentQuestionKey, sessionFinished, startSpeakQuestion]);

  // マイクボタンを押したとき（押している間起動／短タップでのON・OFFトグル両対応・全問題で常時利用可能）
  const startMicRecording = useCallback(() => {
    if (!currentChunk) return;
    playTactileClick(settings.clickSound);
    sttControllerRef.current?.stop();
    setSttTranscript('');
    setSttMatchRate(undefined);
    setSttActive(true);
    micPressStartMsRef.current = performance.now();

    sttControllerRef.current = startAuxiliaryStt({
      level: settings.level,
      disableSilenceTimeout: true,
      onTranscriptUpdate: (text) => {
        setSttTranscript(text);
        const match = calculateSttMatch(currentChunk.enText, text);
        setSttMatchRate(match.matchRate);
      },
      onFinish: (finalText) => {
        setSttActive(false);
        if (finalText) {
          setSttTranscript(finalText);
          const match = calculateSttMatch(currentChunk.enText, finalText);
          setSttMatchRate(match.matchRate);
        }
      },
      onFallbackToSelfJudge: () => {
        setSttActive(false);
      },
    });
  }, [currentChunk, settings.clickSound, settings.level]);

  const stopMicRecording = useCallback(() => {
    playTactileClick(settings.clickSound);
    sttControllerRef.current?.stop();
    setSttActive(false);
  }, [settings.clickSound]);

  const handleMicPointerDown = () => {
    if (sttActive) {
      // すでに録音中ならタップで停止
      stopMicRecording();
    } else {
      startMicRecording();
    }
  };

  const handleMicPointerUp = () => {
    if (!sttActive) return;
    const heldMs = performance.now() - micPressStartMsRef.current;
    // 350ms以上長押ししていた場合は指を離した瞬間に録音停止（Push-to-Talk）
    if (heldMs >= 350) {
      stopMicRecording();
    }
  };

  // 自己判定ボタン（緑／黄／赤）タップ（回答確定と同時に正解の英語音声 currentChunk.enText を再生し、発音・ミッション・答えを100%一致させる）
  const handleSelfJudge = async (selfRating: Rating) => {
    playTactileClick(settings.clickSound);
    sttControllerRef.current?.stop();
    setSttActive(false);

    const completionMs = Math.max(
      1,
      Math.round(performance.now() - questionStartMsRef.current)
    );
    const resolved = resolveSpeechRating({
      selfJudgedRating: selfRating,
      sttMatchRate,
    });

    setAnsweredResult({
      rating: resolved.finalRating,
      completionMs,
    });
    setSessionResults((prev) => [...prev, resolved.finalRating]);

    // 回答確定時にミッションと完全一致する正解英語音声（currentChunk.enText）を再生
    void speakEnglishText({
      text: currentChunk.enText,
      rate: settings.ttsRate,
      multiSpeakerRandom: settings.level >= 2,
    });

    const elapsedSeconds = Math.max(
      1,
      Math.round((Date.now() - sessionStartMsRef.current) / 1000)
    );
    const updatedSession: Session = {
      ...session,
      activeSeconds: elapsedSeconds,
    };

    const attempt: Attempt = {
      id: `att_speak_${Date.now()}_${currentIndex}`,
      chunkId: currentChunk.id,
      sessionId: session.id,
      exerciseType,
      studyDate: currentStudyDate,
      startedAt: Date.now(),
      reactionMs: completionMs,
      completionMs,
      replayBeforeShown: 0,
      replayAfterShown: 0,
      rating: resolved.finalRating,
      missType: resolved.finalRating === 'red' ? 'speech_block' : undefined,
      inputMode: 'voice',
      selfJudged: true,
      sttTranscript: sttTranscript || undefined,
      sttMatch: resolved.sttMatch,
    };

    await onRecordAttempt({
      attempt,
      session: updatedSession,
      updateSrs: true,
    });
  };

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
      const nextBatch = buildSessionBatch({
        allChunks,
        reviewStates,
        recentAttempts,
        currentStudyDate,
        currentLevel: settings.level,
        mode: 'speak',
      });
      setBatch(nextBatch);
      setBatchGeneration((prev) => prev + 1);
      setCurrentIndex(0);
    }
  };

  const handleFinishEarly = async () => {
    sttControllerRef.current?.stop();
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

  if (sessionFinished) {
    const total = Math.max(1, sessionResults.length);
    const greens = sessionResults.filter((r) => r === 'green').length;
    const greenPercent = Math.round((greens / total) * 100);

    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div
          style={{
            backgroundColor: palette.card,
            borderColor: palette.border,
            color: palette.text,
          }}
          className="border rounded-xl p-6 space-y-5"
          data-testid="speak-summary-card"
        >
          <div className="flex items-center gap-2 font-bold text-xl">
            <Award size={24} strokeWidth={1.75} color="currentColor" />
            <span>発話ドリル完了</span>
          </div>
          <p className="text-sm">
            2秒以内発話（緑）の割合:{' '}
            <strong className="text-lg font-mono">{greenPercent}%</strong> (
            {greens}/{sessionResults.length}問)
          </p>
          <p className="text-xs opacity-80">
            昇格ゲート③ 発話進捗: {Math.round(gateStatus.speakingGreenRate * 100)}%
            ({gateStatus.speakingSampled}/40回)
          </p>
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

  const violatedNgWords = containsNgWord(sttTranscript, currentChunk.ngWords);
  const isAllEnglish =
    settings.level === 4 && Boolean(settings.allEnglishMode);
  const situationMeaning = extractSituationMeaning(currentChunk);
  const wordOrderBreakdown = extractWordOrderBreakdown(currentChunk);

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between text-xs font-semibold">
        <div className="flex items-center gap-2">
          <Mic size={16} strokeWidth={1.75} color="currentColor" />
          <span>
            発話ドリルモード ({plannedMinutes}分) / 問題 {currentIndex + 1} /{' '}
            {batch.length}
          </span>
        </div>
        <button
          type="button"
          onClick={handleFinishEarly}
          style={{ borderColor: palette.border }}
          className="px-2.5 py-1 rounded border text-xs"
          data-testid="speak-finish-early-button"
        >
          終了して集計
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-3">
          {/* 状況ビジュアルカード（回答前はアイコン＋3タグのみ、回答後に意味・カテゴリバッジ・正解英文を表示） */}
          <VisualCard
            chunk={currentChunk}
            palette={palette}
            allEnglishMode={isAllEnglish}
            showSituationMeaning={Boolean(answeredResult)}
            showCategoryBadge={Boolean(answeredResult)}
            showEnglishSubtitle={Boolean(answeredResult)}
          />

          {/* 音声再生＆必要なときだけ開くヒントバー（回答前は日本語ネタバレを隠し、音と状況カードだけで発話する） */}
          <div
            style={{
              backgroundColor: palette.card,
              borderColor: palette.border,
            }}
            className="border rounded-lg p-4 space-y-2.5"
            data-testid="speak-controls-bar"
          >
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  playTactileClick(settings.clickSound);
                  void speakEnglishText({
                    text: currentChunk.enText,
                    rate: settings.ttsRate,
                    multiSpeakerRandom: settings.level >= 2,
                  });
                }}
                style={{
                  backgroundColor: palette.background,
                  borderColor: palette.text,
                  borderBottomWidth: '3px',
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border text-xs font-bold tactile-block"
                data-testid="speak-play-audio-button"
              >
                <Volume2 size={15} strokeWidth={1.75} color="currentColor" />
                <span>英語音声を再生</span>
              </button>

              <button
                type="button"
                onClick={() => setShowFirstWordHint((prev) => !prev)}
                style={{ borderColor: palette.border }}
                className="text-xs font-semibold px-3 py-2 rounded-lg border tactile-btn"
                data-testid="first-word-hint-button"
              >
                {showFirstWordHint
                  ? `最初の語: "${currentChunk.blocks[0]?.text ?? ''}"`
                  : '最初の1語ヒント'}
              </button>

              {!isAllEnglish && (
                <button
                  type="button"
                  onClick={() => setShowSituationHint((prev) => !prev)}
                  style={{ borderColor: palette.border }}
                  className="text-xs font-semibold px-3 py-2 rounded-lg border tactile-btn"
                  data-testid="situation-hint-button"
                >
                  {showSituationHint ? '場面ヒントを隠す' : '言いたいことヒント'}
                </button>
              )}
            </div>

            {showSituationHint && !isAllEnglish && (
              <div
                style={{
                  backgroundColor: palette.background,
                  borderColor: palette.border,
                }}
                className="p-3 rounded border space-y-1 text-xs"
                data-testid="speak-mission-intent"
              >
                <p className="font-bold text-sm" data-testid="speak-mission-text">
                  {situationMeaning}
                </p>
                <p className="opacity-85">{wordOrderBreakdown}</p>
              </div>
            )}
          </div>

          {/* Lv.3 パラフレーズ用 NGワード表示 */}
          {currentChunk.ngWords && currentChunk.ngWords.length > 0 && (
            <div
              style={{
                backgroundColor: palette.card,
                borderColor: palette.crimsonText ?? palette.border,
              }}
              className="border rounded-lg p-3 text-xs font-semibold"
            >
              <span>Lv.3 言い換え制約（NGワード使用禁止）：</span>
              <span className="ml-2 font-mono">
                {currentChunk.ngWords.join(', ')}
              </span>
            </div>
          )}
        </div>

        <div>
          {answeredResult ? (
            <PostAnswerCard
              chunk={currentChunk}
              rating={answeredResult.rating}
              reactionMs={answeredResult.completionMs}
              completionMs={answeredResult.completionMs}
              palette={palette}
              allEnglishMode={isAllEnglish}
              sttTranscript={sttTranscript}
              sttMatchRate={sttMatchRate}
              onReplayAudio={() => {
                // 回答後カードでは正解音声（currentChunk.enText）をいつでも再生可能
                void speakEnglishText({
                  text: currentChunk.enText,
                  rate: settings.ttsRate,
                });
              }}
              onNextQuestion={handleNextQuestion}
              onReportUnnatural={onReportUnnatural}
            />
          ) : (
            <div
              style={{
                backgroundColor: palette.card,
                borderColor: palette.border,
              }}
              className="border rounded-lg p-5 space-y-4"
            >
              <div className="space-y-1">
                <p className="font-bold text-sm">
                  状況ビジュアルカード（場所・相手・感情）を見て英語を発話してください（回答後に正解英文と解説が表示されます）
                </p>
                <p className="text-xs opacity-75">
                  下のマイクボタンを押している間（またはタップで）話し、発話後に3つのボタンで自己判定してください。
                </p>
              </div>

              {/* マイクボタン（全問題で常時表示：押している間マイク起動 ／ タップで開始・停止トグル）＆ STT補助パネル */}
              <div
                style={{
                  backgroundColor: palette.background,
                  borderColor: sttActive
                    ? (palette.amberSurface ?? palette.text)
                    : palette.border,
                }}
                className="p-4 rounded-lg border space-y-3"
                data-testid="stt-status-box"
              >
                <button
                  type="button"
                  onPointerDown={handleMicPointerDown}
                  onPointerUp={handleMicPointerUp}
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    backgroundColor: sttActive
                      ? (palette.amberSurface ?? palette.text)
                      : palette.card,
                    color: sttActive
                      ? (palette.amberSurfaceText ?? '#1C1917')
                      : palette.text,
                    borderColor: palette.text,
                    borderBottomWidth: '3px',
                    touchAction: 'none',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                  }}
                  className="w-full min-h-[56px] px-4 py-3 rounded-lg border-2 font-bold text-sm flex items-center justify-center gap-2 tactile-block select-none"
                  data-testid="push-to-talk-mic-button"
                >
                  <Mic size={20} strokeWidth={1.75} color="currentColor" />
                  <span>
                    {sttActive
                      ? 'マイク聞き取り中...（離す／タップで停止）'
                      : 'マイクボタンを押している間（またはタップで）英語を話す'}
                  </span>
                </button>

                <div className="flex items-center justify-between text-xs font-semibold">
                  <span>
                    マイク状態:{' '}
                    {sttActive
                      ? '録音・認識中...'
                      : sttTranscript
                        ? '認識完了'
                        : isSttSupported()
                          ? '待機中（ボタンを押して発話）'
                          : '待機中（声に出して自己判定）'}
                  </span>
                  {typeof sttMatchRate === 'number' && (
                    <span>
                      一致率: {Math.round(sttMatchRate * 100)}%{' '}
                      {sttMatchRate >= 0.8 ? '（一致）' : '（80%未満）'}
                    </span>
                  )}
                </div>
                {sttTranscript && (
                  <p className="font-mono text-sm pt-1" data-testid="stt-transcript-text">
                    &ldquo;{sttTranscript}&rdquo;
                  </p>
                )}
                {violatedNgWords.length > 0 && (
                  <p
                    style={{ color: palette.crimsonText }}
                    className="font-bold text-xs pt-1"
                  >
                    NGワードが含まれています: {violatedNgWords.join(', ')}
                  </p>
                )}
              </div>

              {/* 自己判定3ボタン（要件2-2：2秒以内に言えた（緑）／遅れた（黄）／言えなかった（赤）） */}
              <div className="grid grid-cols-1 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleSelfJudge('green')}
                  style={{
                    backgroundColor: palette.card,
                    borderColor: palette.greenText ?? palette.text,
                    borderBottomWidth: '3px',
                    color: palette.greenText ?? palette.text,
                  }}
                  className="min-h-[56px] px-4 py-3 rounded-lg border-2 font-bold text-sm flex items-center justify-center gap-2 tactile-block"
                  data-testid="self-judge-green"
                >
                  <CheckCircle
                    size={18}
                    strokeWidth={1.75}
                    color="currentColor"
                  />
                  <span>2秒以内に言えた（緑）</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelfJudge('yellow')}
                  style={{
                    backgroundColor: palette.card,
                    borderColor: palette.amberText ?? palette.text,
                    borderBottomWidth: '3px',
                    color: palette.amberText ?? palette.text,
                  }}
                  className="min-h-[56px] px-4 py-3 rounded-lg border-2 font-bold text-sm flex items-center justify-center gap-2 tactile-block"
                  data-testid="self-judge-yellow"
                >
                  <AlertCircle
                    size={18}
                    strokeWidth={1.75}
                    color="currentColor"
                  />
                  <span>遅れた（黄）</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelfJudge('red')}
                  style={{
                    backgroundColor: palette.card,
                    borderColor: palette.crimsonText ?? palette.text,
                    borderBottomWidth: '3px',
                    color: palette.crimsonText ?? palette.text,
                  }}
                  className="min-h-[56px] px-4 py-3 rounded-lg border-2 font-bold text-sm flex items-center justify-center gap-2 tactile-block"
                  data-testid="self-judge-red"
                >
                  <XCircle size={18} strokeWidth={1.75} color="currentColor" />
                  <span>言えなかった（赤）</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
