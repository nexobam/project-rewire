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
    voicesLoaded = true;
    return selectEnglishVoices(initial);
  }

  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      voicesLoaded = true;
      resolve(selectEnglishVoices(synth.getVoices()));
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
    window.speechSynthesis.cancel();
    if (typeof SpeechSynthesisUtterance !== 'undefined') {
      const silentUtterance = new SpeechSynthesisUtterance('');
      silentUtterance.volume = 0;
      silentUtterance.lang = 'en-US';
      window.speechSynthesis.speak(silentUtterance);
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
  // 読み上げの直前には必ず cancel() を呼ぶ（要件6-1）
  synth.cancel();

  const voices = await getAvailableEnglishVoices();

  return new Promise<void>((resolve) => {
    let completed = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const completeOnce = () => {
      if (completed) return;
      completed = true;
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      onEnd?.();
      resolve();
    };

    // onend が発火しない場合のタイムアウト保護（要件6-2）
    timerId = setTimeout(() => {
      try {
        synth.cancel();
      } catch {
        // 無視
      }
      completeOnce();
    }, timeoutMs);

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
        onStart?.();
      };
      utterance.onend = () => {
        completeOnce();
      };
      utterance.onerror = () => {
        completeOnce();
      };

      onStart?.();
      synth.speak(utterance);
    } catch {
      completeOnce();
    }
  });
}
