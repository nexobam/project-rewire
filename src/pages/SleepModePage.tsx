// スリープ・プライミングモード画面（就寝前の3分・スリープ専用テーマ配色・苦戦3チャンク音声再生・SRS非反映の自己判定・要件4-4, 7）

import React, { useMemo, useState } from 'react';
import { CheckCircle, Moon, Play, Volume2 } from 'lucide-react';
import type { ThemePalette } from '../domain/contrast';
import { playTactileClick, unlockAudioContext } from '../services/audioService';
import {
  speakEnglishText,
  unlockSpeechSynthesis,
} from '../services/ttsService';
import type { Attempt, Chunk, Rating, Session } from '../types';

export interface SleepModePageProps {
  allChunks: Chunk[];
  recentAttempts: Attempt[];
  currentStudyDate: string;
  ttsRate: number;
  clickSound: boolean;
  palette: ThemePalette; // スリープテーマ（#140F0A / #1C150E / #2A2016 / #D97706）
  onRecordSleepAttempt: (params: {
    attempt: Attempt;
    session: Session;
    updateSrs: false;
  }) => Promise<void>;
  onCompleteSession: (session: Session) => Promise<void>;
  onExitHome: () => void;
}

export const SleepModePage: React.FC<SleepModePageProps> = ({
  allChunks,
  recentAttempts,
  currentStudyDate,
  ttsRate,
  clickSound,
  palette,
  onRecordSleepAttempt,
  onCompleteSession,
  onExitHome,
}) => {
  // その日（または直近）苦戦した3チャンクを選出
  const targetThreeChunks = useMemo(() => {
    const active = allChunks.filter((c) => !c.disabled);
    const chunkMap = new Map(active.map((c) => [c.id, c]));
    const pick: Chunk[] = [];
    const seen = new Set<string>();

    const struggled = [...recentAttempts]
      .reverse()
      .filter((a) => a.rating === 'red' || a.rating === 'yellow');

    for (const att of struggled) {
      const c = chunkMap.get(att.chunkId);
      if (c && !seen.has(c.id)) {
        pick.push(c);
        seen.add(c.id);
        if (pick.length === 3) break;
      }
    }

    for (const c of active) {
      if (pick.length >= 3) break;
      if (!seen.has(c.id)) {
        pick.push(c);
        seen.add(c.id);
      }
    }

    return pick;
  }, [allChunks, recentAttempts]);

  const [session] = useState<Session>(() => ({
    id: `sess_sleep_${Date.now()}`,
    mode: 'sleep',
    plannedMinutes: 3,
    activeSeconds: 180,
    studyDate: currentStudyDate,
    startedAt: Date.now(),
  }));

  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [hasListenedAll, setHasListenedAll] = useState(false);
  const [completed, setCompleted] = useState(false);

  const handlePlayAllThreeAudioOnly = async () => {
    unlockSpeechSynthesis();
    unlockAudioContext();
    playTactileClick(clickSound);

    for (let i = 0; i < targetThreeChunks.length; i++) {
      setPlayingIdx(i);
      await speakEnglishText({
        text: targetThreeChunks[i].enText,
        rate: Math.max(0.75, ttsRate * 0.9),
      });
    }
    setPlayingIdx(null);
    setHasListenedAll(true);
  };

  // 最後に1回、「頭の中で言えたか」を自己判定させる（記録するだけで、SRSには一切反映しない：updateSrs: false・要件4-4）
  const handleFinalSelfJudge = async (rating: Rating) => {
    playTactileClick(clickSound);
    const primaryChunk = targetThreeChunks[0];
    if (primaryChunk) {
      const attempt: Attempt = {
        id: `att_sleep_${Date.now()}`,
        chunkId: primaryChunk.id,
        sessionId: session.id,
        exerciseType: 'speak',
        studyDate: currentStudyDate,
        startedAt: Date.now(),
        reactionMs: null,
        completionMs: null,
        replayBeforeShown: 0,
        replayAfterShown: 0,
        rating,
        inputMode: 'silent',
        selfJudged: true,
      };
      await onRecordSleepAttempt({
        attempt,
        session,
        updateSrs: false,
      });
    }

    const finishedSession: Session = {
      ...session,
      endedAt: Date.now(),
    };
    await onCompleteSession(finishedSession);
    setCompleted(true);
  };

  return (
    <div
      style={{
        backgroundColor: palette.background,
        color: palette.text,
      }}
      className="min-h-[80vh] max-w-2xl mx-auto px-4 py-10 space-y-6"
      data-testid="sleep-mode-container"
    >
      <div
        style={{
          backgroundColor: palette.card,
          borderColor: palette.border,
          color: palette.text,
        }}
        className="border rounded-xl p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Moon size={20} strokeWidth={1.75} color="currentColor" />
            <span>スリープ・プライミングモード（就寝前の3分）</span>
          </div>
          <button
            type="button"
            onClick={onExitHome}
            style={{ borderColor: palette.border }}
            className="px-3 py-1 rounded border text-xs"
          >
            戻る
          </button>
        </div>

        <p className="text-xs opacity-90">
          目に優しいスリープ配色です。目を閉じて、今日苦戦した3つのチャンクを音声だけで聴き流しましょう。
        </p>

        {/* 音声だけで流す（文字は出さずチャンク番号のみ表示） */}
        <div className="space-y-2">
          {targetThreeChunks.map((chunk, idx) => (
            <div
              key={chunk.id}
              style={{
                backgroundColor: palette.background,
                borderColor: palette.border,
              }}
              className="p-3.5 rounded-lg border flex items-center justify-between text-xs"
            >
              <span className="font-semibold">
                プライミングチャンク #{idx + 1}（{chunk.visual.tags.join('／')}）
              </span>
              <span className="font-mono">
                {playingIdx === idx ? '再生中...' : '音声のみ'}
              </span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handlePlayAllThreeAudioOnly}
          style={{
            backgroundColor: palette.background,
            borderColor: palette.text,
            borderBottomWidth: '3px',
            color: palette.text,
          }}
          className="w-full min-h-[56px] px-5 py-3 rounded-lg border font-bold text-sm flex items-center justify-center gap-2 tactile-block"
          data-testid="play-sleep-audio-button"
        >
          {playingIdx !== null ? (
            <Volume2 size={18} strokeWidth={1.75} color="currentColor" />
          ) : (
            <Play size={18} strokeWidth={1.75} color="currentColor" />
          )}
          <span>3チャンクを連続で聴く</span>
        </button>

        {/* 最後に1回、「頭の中で言えたか」を自己判定させる（SRS非反映） */}
        {!completed ? (
          <div
            style={{ borderColor: palette.border }}
            className="pt-4 border-t space-y-3"
          >
            <p className="text-xs font-bold">
              聴き終えたら最後に1回、3チャンクを「頭の中で言えたか」自己判定してください（記録のみでSRS段階には影響しません）：
            </p>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleFinalSelfJudge('green')}
                style={{
                  borderColor: palette.border,
                  borderBottomWidth: '3px',
                }}
                className="min-h-[48px] py-2 rounded-lg border font-bold text-xs tactile-block"
                data-testid="sleep-judge-green"
              >
                言えた
              </button>
              <button
                type="button"
                onClick={() => handleFinalSelfJudge('yellow')}
                style={{
                  borderColor: palette.border,
                  borderBottomWidth: '3px',
                }}
                className="min-h-[48px] py-2 rounded-lg border font-bold text-xs tactile-block"
                data-testid="sleep-judge-yellow"
              >
                おおよそ言えた
              </button>
              <button
                type="button"
                onClick={() => handleFinalSelfJudge('red')}
                style={{
                  borderColor: palette.border,
                  borderBottomWidth: '3px',
                }}
                className="min-h-[48px] py-2 rounded-lg border font-bold text-xs tactile-block"
                data-testid="sleep-judge-red"
              >
                まだ曖昧
              </button>
            </div>
            {!hasListenedAll && (
              <p className="text-[11px] opacity-70">
                ※先に上のボタンで音声を聴いてから判定することをおすすめします。
              </p>
            )}
          </div>
        ) : (
          <div
            style={{ borderColor: palette.border }}
            className="pt-4 border-t text-center space-y-3"
            data-testid="sleep-complete-message"
          >
            <div className="flex justify-center">
              <CheckCircle size={28} strokeWidth={1.75} color="currentColor" />
            </div>
            <p className="font-bold text-sm">
              スリープ・プライミングを記録しました。おやすみなさい。
            </p>
            <button
              type="button"
              onClick={onExitHome}
              style={{
                borderColor: palette.text,
                borderBottomWidth: '3px',
              }}
              className="w-full min-h-[48px] py-2.5 rounded-lg border font-bold text-xs tactile-block"
            >
              ホームへ戻る
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
