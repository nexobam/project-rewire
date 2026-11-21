// Web Audio API 制御サービス（iOSアンロック・クリック音・バイブレーション・Lv.3環境ノイズ生成）

let sharedAudioCtx: AudioContext | null = null;
let activeNoiseStopper: (() => void) | null = null;

/**
 * AudioContext を取得・アンロックする（要件6-1）
 */
export function unlockAudioContext(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return null;

    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    if (
      sharedAudioCtx.state === 'suspended' ||
      (sharedAudioCtx.state as string) === 'interrupted'
    ) {
      void sharedAudioCtx.resume();
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * タップ時の触覚フィードバック（バイブレーション＋控えめなクリック音）（要件6-4）
 * - navigator.vibrate?.(20) で非対応環境でもエラーにならないようにする
 */
export function playTactileClick(clickSoundEnabled: boolean = true): void {
  try {
    if (typeof navigator !== 'undefined') {
      navigator.vibrate?.(20);
    }
  } catch {
    // 非対応環境では無視
  }

  if (!clickSoundEnabled) return;

  try {
    const ctx = unlockAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.025);

    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.025);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.03);
  } catch {
    // AudioContext未許可環境では無視
  }
}

/**
 * Lv.3 用の環境ノイズ（カフェ・アリーナのざわめき風バンドパスホワイトノイズ）を
 * 外部音源を一切使わず Web Audio API のノイズバッファとフィルタで生成する（要件6-10）
 */
export function startAmbientNoise(): () => void {
  stopAmbientNoise();

  try {
    const ctx = unlockAudioContext();
    if (!ctx) return () => {};

    const bufferSize = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(650, ctx.currentTime);
    filter.Q.setValueAtTime(0.8, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.025, ctx.currentTime);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    whiteNoise.start(0);

    const stopper = () => {
      try {
        whiteNoise.stop();
        whiteNoise.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        // 無視
      }
    };
    activeNoiseStopper = stopper;
    return stopper;
  } catch {
    return () => {};
  }
}

/**
 * 再生中の背景ノイズを停止する
 */
export function stopAmbientNoise(): void {
  if (activeNoiseStopper) {
    activeNoiseStopper();
    activeNoiseStopper = null;
  }
}
