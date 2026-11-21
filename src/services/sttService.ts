// Web Speech API (STT / SpeechRecognition) 補助認識・Push-to-Talk制御サービス（要件4-2）

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
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

// 前回の認識インスタンスが残って2問目以降のマイク起動を阻害しないようシングルトン管理
let activeRecognitionInstance: SpeechRecognitionInstance | null = null;

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
 * 補助音声認識（またはPush-to-Talkマイクセッション）を開始する
 * - disableSilenceTimeout: true（Push-to-Talk中）はユーザーがボタンを離す／停止するまで認識を維持する
 * - 2問目以降も確実に起動するよう、既存TTSのキャンセルと前回インスタンスのクリーンアップを行う
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

  // マイク起動前に再生中のTTS音声があれば確実に停止してオーディオ競合を防ぐ
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch {
    // 無視
  }

  // 前回の認識インスタンスが残っていればクリーンアップ
  if (activeRecognitionInstance) {
    try {
      activeRecognitionInstance.onresult = null;
      activeRecognitionInstance.onerror = null;
      activeRecognitionInstance.onend = null;
      activeRecognitionInstance.abort();
    } catch {
      // 無視
    }
    activeRecognitionInstance = null;
  }

  let manualStopped = false;
  let finished = false;
  let committedTranscript = '';
  let currentSegmentTranscript = '';
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;

  const getCombinedTranscript = () =>
    [committedTranscript, currentSegmentTranscript]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  const clearSilenceTimer = () => {
    if (silenceTimer !== null) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  };

  // STT非対応環境でも、Push-to-Talkボタンを押している間はセッションを維持し、stop()時に完了させる
  if (!isSttSupported()) {
    if (!disableSilenceTimeout) {
      onFallbackToSelfJudge?.();
      return { stop: () => {} };
    }
    return {
      stop: () => {
        if (finished) return;
        finished = true;
        manualStopped = true;
        onFallbackToSelfJudge?.();
        onFinish('');
      },
    };
  }

  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition;
  if (!Ctor) {
    if (!disableSilenceTimeout) {
      onFallbackToSelfJudge?.();
      return { stop: () => {} };
    }
    return {
      stop: () => {
        if (finished) return;
        finished = true;
        manualStopped = true;
        onFallbackToSelfJudge?.();
        onFinish('');
      },
    };
  }

  const silenceMs = getSilenceCutoffMs(level);
  let recognition: SpeechRecognitionInstance;
  try {
    recognition = new Ctor();
    activeRecognitionInstance = recognition;
  } catch {
    onFallbackToSelfJudge?.();
    return { stop: () => {} };
  }

  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;

  const finishOnce = () => {
    if (finished) return;
    finished = true;
    manualStopped = true;
    clearSilenceTimer();
    try {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
    } catch {
      // 無視
    }
    if (activeRecognitionInstance === recognition) {
      activeRecognitionInstance = null;
    }
    onFinish(getCombinedTranscript());
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
    currentSegmentTranscript = parts.join(' ').trim();
    onTranscriptUpdate(getCombinedTranscript());
    resetSilenceTimer();
  };

  recognition.onerror = (event) => {
    const errCode = event?.error ?? '';
    // Push-to-Talk中に一時的な無音（no-speech）が発生した場合は停止せず継続する
    if (disableSilenceTimeout && !manualStopped && errCode === 'no-speech') {
      return;
    }
    clearSilenceTimer();
    onFallbackToSelfJudge?.();
    finishOnce();
  };

  recognition.onend = () => {
    // Push-to-Talk（ボタンを押している間）にブラウザが自動区切りした場合は再起動して聞き取りを継続
    if (disableSilenceTimeout && !manualStopped && !finished) {
      if (currentSegmentTranscript) {
        committedTranscript = getCombinedTranscript();
        currentSegmentTranscript = '';
      }
      try {
        recognition.start();
        return;
      } catch {
        // 再起動できない場合のみ終了へ進む
      }
    }
    finishOnce();
  };

  try {
    recognition.start();
    resetSilenceTimer();
  } catch {
    onFallbackToSelfJudge?.();
    if (!disableSilenceTimeout) {
      finishOnce();
    }
  }

  return {
    stop: finishOnce,
  };
}
