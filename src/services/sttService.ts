// Web Speech API (STT / SpeechRecognition) 補助認識サービス（要件4-2）

import type { Level } from '../types';

/**
 * レベルに応じた無音区切り時間（ms）を返す
 * - Lv.1〜2: 1.5秒（1500ms）
 * - Lv.3〜4: 1.0秒（1000ms）
 */
export function getSilenceCutoffMs(level: Level): number {
  return level >= 3 ? 1000 : 1500;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

/**
 * ブラウザが SpeechRecognition / webkitSpeechRecognition に対応しており、オンラインか判定する
 */
export function isSttSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
}

export interface SttSessionController {
  stop: () => void;
}

/**
 * 補助音声認識を開始する
 * - 1.5秒（Lv.3以降は1.0秒）の無音で自動区切り
 * - 非対応、オフライン、マイク不可、エラー発生時は onFallbackToSelfJudge を呼び、自己判定を妨げない
 */
export function startAuxiliaryStt(params: {
  level: Level;
  onTranscriptUpdate: (transcript: string) => void;
  onFinish: (finalTranscript: string) => void;
  onFallbackToSelfJudge?: () => void;
  disableSilenceTimeout?: boolean;
}): SttSessionController {
  const {
    level,
    onTranscriptUpdate,
    onFinish,
    onFallbackToSelfJudge,
    disableSilenceTimeout = false,
  } = params;

  if (!isSttSupported()) {
    onFallbackToSelfJudge?.();
    return { stop: () => {} };
  }

  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
  if (!Ctor) {
    onFallbackToSelfJudge?.();
    return { stop: () => {} };
  }

  const silenceMs = getSilenceCutoffMs(level);
  let recognition: SpeechRecognitionInstance;
  try {
    recognition = new Ctor();
  } catch {
    onFallbackToSelfJudge?.();
    return { stop: () => {} };
  }

  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;

  let latestTranscript = '';
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;

  const clearSilenceTimer = () => {
    if (silenceTimer !== null) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  };

  const finishOnce = () => {
    if (finished) return;
    finished = true;
    clearSilenceTimer();
    try {
      recognition.stop();
    } catch {
      // 無視
    }
    onFinish(latestTranscript.trim());
  };

  const resetSilenceTimer = () => {
    clearSilenceTimer();
    if (disableSilenceTimeout) return;
    silenceTimer = setTimeout(() => {
      finishOnce();
    }, silenceMs);
  };

  recognition.onresult = (event) => {
    const parts: string[] = [];
    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];
      if (res && res[0] && typeof res[0].transcript === 'string') {
        parts.push(res[0].transcript);
      }
    }
    latestTranscript = parts.join(' ').trim();
    onTranscriptUpdate(latestTranscript);
    resetSilenceTimer();
  };

  recognition.onerror = () => {
    clearSilenceTimer();
    onFallbackToSelfJudge?.();
    finishOnce();
  };

  recognition.onend = () => {
    finishOnce();
  };

  try {
    recognition.start();
    resetSilenceTimer();
  } catch {
    onFallbackToSelfJudge?.();
  }

  return {
    stop: finishOnce,
  };
}
