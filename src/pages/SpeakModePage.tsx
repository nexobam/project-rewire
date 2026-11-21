// 発話ドリルモード画面（5/15/30分・オウム返し禁止＝お手本音声なし・自己判定3ボタン＋STT補助・Lv.3 NGワード対応・要件2-2, 4-2）

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
  const [sttTranscript, setSttTranscript] = useState('');
  const [sttMatchRate, setSttMatchRate] = useState<number | undefined>(
    undefined
  );
  const [sttActive, setSttActive] = useState(false);
  const [answeredResult, setAnsweredResult] = useState<{
    rating: Rating;
    completionMs: number;
  } | null>(null);
  const [sessionResults, setSessionResults] = useState<Rating[]>([]);
  const [sessionFinished, setSessionFinished] = useState(false);

  const sttControllerRef = useRef<SttSessionController | null>(null);
  const questionStartMsRef = useRef<number>(performance.now());
  const sessionStartMsRef = useRef<number>(Date.now());

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

  // 問題開始：オウム返しは禁止（お手本音声は絶対に流さない！流してよいのは「相手の短い問いかけ音声 promptAudioText」だけ・要件4-2）
  const startSpeakQuestion = useCallback(
    (chunk: Chunk) => {
      sttControllerRef.current?.stop();
      setAnsweredResult(null);
      setSttTranscript('');
      setSttMatchRate(undefined);
      questionStartMsRef.current = performance.now();

      const beginSttIfAvailable = () => {
        if (!isSttSupported()) {
          setSttActive(false);
          return;
        }
        setSttActive(true);
        sttControllerRef.current = startAuxiliaryStt({
          level: settings.level,
          onTranscriptUpdate: (text) => {
            setSttTranscript(text);
            const match = calculateSttMatch(chunk.enText, text);
            setSttMatchRate(match.matchRate);
          },
          onFinish: (finalText) => {
            setSttActive(false);
            if (finalText) {
              setSttTranscript(finalText);
              const match = calculateSttMatch(chunk.enText, finalText);
              setSttMatchRate(match.matchRate);
            }
          },
          onFallbackToSelfJudge: () => {
            setSttActive(false);
          },
        });
      };

      if (chunk.promptAudioText) {
        void speakEnglishText({
          text: chunk.promptAudioText,
          rate: settings.ttsRate,
          multiSpeakerRandom: settings.level >= 2,
          onEnd: () => {
            questionStartMsRef.current = performance.now();
            beginSttIfAvailable();
          },
        });
      } else {
        beginSttIfAvailable();
      }
    },
    [settings.level, settings.ttsRate]
  );

  useEffect(() => {
    if (currentChunk && !sessionFinished) {
      startSpeakQuestion(currentChunk);
    }
  }, [currentChunk, sessionFinished, startSpeakQuestion]);

  // 自己判定ボタン（緑／黄／赤）タップ（STT結果にかかわらず自己判定が主・要件2-2）
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
        >
          終了して集計
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className="space-y-3">
          {/* 状況ビジュアルカード（お手本音声は絶対に流さない・要件4-2） */}
          <VisualCard
            chunk={currentChunk}
            palette={palette}
            allEnglishMode={
              settings.level === 4 && Boolean(settings.allEnglishMode)
            }
            showEnglishSubtitle={Boolean(answeredResult)}
          />

          {/* 相手の短い問いかけ音声がある場合 */}
          {currentChunk.promptAudioText && (
            <div
              style={{
                backgroundColor: palette.card,
                borderColor: palette.border,
              }}
              className="border rounded-lg p-3.5 flex items-center justify-between gap-3 text-xs"
            >
              <div>
                <span className="font-bold">相手の問いかけきっかけ：</span>
                {settings.level >= 2 && (
                  <span className="ml-1 opacity-85">
                    &ldquo;{currentChunk.promptAudioText}&rdquo;
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  void speakEnglishText({
                    text: currentChunk.promptAudioText!,
                    rate: settings.ttsRate,
                  });
                }}
                style={{ borderColor: palette.border }}
                className="flex items-center gap-1 px-2.5 py-1 rounded border font-semibold shrink-0"
              >
                <Volume2 size={14} strokeWidth={1.75} color="currentColor" />
                <span>問いかけを再生</span>
              </button>
            </div>
          )}

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
              allEnglishMode={
                settings.level === 4 && Boolean(settings.allEnglishMode)
              }
              sttTranscript={sttTranscript}
              sttMatchRate={sttMatchRate}
              onReplayAudio={() => {
                // 回答後カードでは初めて正解音声の確認が可能
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
                  状況カードから直接英語を発話してください（お手本音声は流れません）
                </p>
                <p className="text-xs opacity-75">
                  発話後、以下の3つのボタンで自己判定してください（STT認識結果は補助表示であり、あなたの自己判定が常に優先されます）。
                </p>
              </div>

              {/* STT補助パネル */}
              <div
                style={{
                  backgroundColor: palette.background,
                  borderColor: palette.border,
                }}
                className="p-3.5 rounded-lg border text-xs space-y-1"
                data-testid="stt-status-box"
              >
                <div className="flex items-center justify-between font-semibold">
                  <span>
                    STT補助:{' '}
                    {sttActive
                      ? 'マイク聞き取り中...'
                      : isSttSupported()
                        ? '待機／認識完了'
                        : '非対応またはオフライン（自己判定のみで進行）'}
                  </span>
                  {typeof sttMatchRate === 'number' && (
                    <span>
                      一致率: {Math.round(sttMatchRate * 100)}%{' '}
                      {sttMatchRate >= 0.8 ? '（一致）' : '（80%未満）'}
                    </span>
                  )}
                </div>
                {sttTranscript && (
                  <p className="font-mono text-sm pt-1">
                    &ldquo;{sttTranscript}&rdquo;
                  </p>
                )}
                {violatedNgWords.length > 0 && (
                  <p
                    style={{ color: palette.crimsonText }}
                    className="font-bold pt-1"
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
