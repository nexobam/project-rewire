// Web Speech API (TTS) 制御サービス（iOSアンロック・cancel()・onendタイムアウト保護・英語話者選択）

export const MIN_TTS_RATE = 0.7;
export const MAX_TTS_RATE = 1.2;

/**
 * onend が発火しない場合の保護タイムアウト時間（ms）を計算する（要件6-2）
 * 式: (文字数 ÷ 14) ÷ 再生速度 × 1000 + 1000ms
 */
export function calculateTtsTimeoutMs(text: string, rate: number): number {
  const safeRate = Math.min(MAX_TTS_RATE, Math.max(MIN_TTS_RATE, rate || 1.0));
  const charCount = Math.max(1, text.length);
  return Math.ceil((charCount / 14 / safeRate) * 1000 + 1000);
}

/**
 * 利用可能な音声リストから英語音声のみを選択する（日本語音声は絶対に使わない）
 * en-US を優先し、なければ en-* を使う
 */
export function selectEnglishVoices(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice[] {
  const englishAll = voices.filter(
    (v) =>
      /^en(-|_|$)/i.test(v.lang) &&
      !/ja|jpn|japanese/i.test(v.lang) &&
      !/japanese/i.test(v.name)
  );
  const enUs = englishAll.filter((v) => /^en[-_]US/i.test(v.lang));
  return enUs.length > 0 ? enUs : englishAll;
}

let voicesLoaded = false;
let cachedVoices: SpeechSynthesisVoice[] = [];

/**
 * 同期的に英語音声一覧を取得する（iOS Safariのユーザータップコンテキストを維持するため）
 */
function getEnglishVoicesSync(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [];
  }
  const current = window.speechSynthesis.getVoices();
  if (current.length > 0) {
    cachedVoices = current;
    voicesLoaded = true;
  }
  return selectEnglishVoices(cachedVoices);
}

/**
 * voiceschanged イベントを待ってから英語音声一覧を取得する（要件6-3）
 */
export async function getAvailableEnglishVoices(): Promise<
  SpeechSynthesisVoice[]
> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return [];
  }

  const synth = window.speechSynthesis;
  const initial = synth.getVoices();
  if (initial.length > 0 || voicesLoaded) {
    if (initial.length > 0) cachedVoices = initial;
    voicesLoaded = true;
    return selectEnglishVoices(cachedVoices);
  }

  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      voicesLoaded = true;
      cachedVoices = synth.getVoices();
      resolve(selectEnglishVoices(cachedVoices));
    };

    const timer = setTimeout(finish, 300);
    synth.addEventListener(
      'voiceschanged',
      () => {
        clearTimeout(timer);
        finish();
      },
      { once: true }
    );
  });
}

/**
 * 開始ボタンのタップイベント内で speechSynthesis をアンロックする（要件6-1）
 */
export function unlockSpeechSynthesis(): void {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    const synth = window.speechSynthesis;
    // 音声リストの事前ウォームアップ
    const voices = synth.getVoices();
    if (voices.length > 0) {
      cachedVoices = voices;
      voicesLoaded = true;
    } else if (!voicesLoaded) {
      synth.addEventListener(
        'voiceschanged',
        () => {
          cachedVoices = synth.getVoices();
          voicesLoaded = true;
        },
        { once: true }
      );
    }

    synth.cancel();
    if (typeof SpeechSynthesisUtterance !== 'undefined') {
      const silentUtterance = new SpeechSynthesisUtterance(' ');
      silentUtterance.volume = 0;
      silentUtterance.lang = 'en-US';
      synth.speak(silentUtterance);
    }
  } catch {
    // 非対応環境では無視
  }
}

export interface SpeakEnglishOptions {
  text: string;
  rate?: number;
  multiSpeakerRandom?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
}

/**
 * 英文を読み上げる
 * - 読み上げ直前に必ず speechSynthesis.cancel() を呼ぶ
 * - (文字数 ÷ 14) ÷ 再生速度 × 1000 + 1000ms を過ぎても onend が来なければ完了とみなして onEnd を発火
 * - Lv.2以降の複数話者モードでは英語音声をランダム選択し、1つしかなければ pitch と rate を少し変えて代替する
 */
let activeTtsToken = 0;

/**
 * 再生中のTTSを即座に安全停止する（画面遷移・アンマウント・次問切替時の音声リーク防止）
 */
export function stopSpeechSynthesis(): void {
  activeTtsToken += 1;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // 無視
    }
  }
}

export async function speakEnglishText(
  options: SpeakEnglishOptions
): Promise<void> {
  const {
    text,
    rate = 1.0,
    multiSpeakerRandom = false,
    onStart,
    onEnd,
  } = options;

  const clampedRate = Math.min(MAX_TTS_RATE, Math.max(MIN_TTS_RATE, rate));
  const timeoutMs = calculateTtsTimeoutMs(text, clampedRate);

  if (
    typeof window === 'undefined' ||
    !('speechSynthesis' in window) ||
    typeof SpeechSynthesisUtterance === 'undefined'
  ) {
    onStart?.();
    onEnd?.();
    return;
  }

  const synth = window.speechSynthesis;
  const myToken = ++activeTtsToken;
  if (synth.speaking || synth.pending) {
    try {
      synth.cancel();
    } catch {
      // 無視
    }
  }

  // iOS Safariのタップイベント同期コンテキストを維持するため、awaitを挟まず同期的に音声を取得する
  const voices = getEnglishVoicesSync();

  return new Promise<void>((resolve) => {
    let completed = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const completeOnce = (invokeOnEnd: boolean = true) => {
      if (completed) return;
      completed = true;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (invokeOnEnd && myToken === activeTtsToken) {
        onEnd?.();
      }
      resolve();
    };

    const armTimeout = (ms: number) => {
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      timerId = setTimeout(() => {
        try {
          if (myToken === activeTtsToken) {
            synth.cancel();
          }
        } catch {
          // 無視
        }
        completeOnce(true);
      }, ms);
    };

    // onend が発火しない場合のタイムアウト保護（起動遅延も考慮して余裕を持たせる）
    armTimeout(timeoutMs);

    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = clampedRate;
      utterance.pitch = 1.0;

      if (voices.length > 0) {
        if (multiSpeakerRandom) {
          if (voices.length > 1) {
            const randomIndex = Math.floor(Math.random() * voices.length);
            utterance.voice = voices[randomIndex];
            utterance.lang = voices[randomIndex].lang;
          } else {
            // 音声が1つしかなければ pitch と rate を少し変えて代わりにする（要件6-3）
            utterance.voice = voices[0];
            utterance.lang = voices[0].lang;
            const pitchOffsets = [0.88, 0.95, 1.06, 1.14];
            const rateOffsets = [-0.06, -0.03, 0.04, 0.07];
            const idx = Math.floor(Math.random() * pitchOffsets.length);
            utterance.pitch = pitchOffsets[idx];
            utterance.rate = Math.min(
              MAX_TTS_RATE,
              Math.max(MIN_TTS_RATE, clampedRate + rateOffsets[idx])
            );
          }
        } else {
          utterance.voice = voices[0];
          utterance.lang = voices[0].lang;
        }
      }

      utterance.onstart = () => {
        if (myToken !== activeTtsToken) return;
        armTimeout(timeoutMs);
        onStart?.();
      };
      utterance.onend = () => {
        completeOnce(true);
      };
      utterance.onerror = () => {
        completeOnce(true);
      };

      onStart?.();
      synth.speak(utterance);
    } catch {
      completeOnce(true);
    }
  });
}
