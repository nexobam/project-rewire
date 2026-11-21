// 代替動作（API未設定・オフライン・429・TTS onend未発火タイムアウト）およびUI（レイアウトシフト防止・キーボード操作・WCAG AAコントラスト比・アイコン実在確認）テスト

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { WHITELIST_ICON_COMPONENTS } from '../components/IconWhitelist';
import { WordOrderBoard } from '../components/WordOrderBoard';
import { LV1_CORE_CHUNKS } from '../data/seed';
import {
  clearAllStoresForTest,
  initializeAndLoadAppData,
  saveSettingsToDb,
} from '../db/database';
import {
  getContrastRatio,
  meetsWcagAA,
  THEME_PALETTES,
} from '../domain/contrast';
import { runFourAiEmployeesPipeline } from '../services/geminiService';
import {
  calculateTtsTimeoutMs,
  speakEnglishText,
} from '../services/ttsService';
import { DEFAULT_SETTINGS, ICON_WHITELIST, type Block } from '../types';

describe('fallback & UI - 代替動作・レイアウトシフト防止・キーボード操作・コントラスト比', () => {
  it('昼・夜・スリープの全カラートークンにおける文字と背景の組み合わせが WCAG AA（4.5:1以上）を満たすこと', () => {
    // 昼テーマ
    const light = THEME_PALETTES.light;
    expect(meetsWcagAA(light.text, light.background)).toBe(true);
    expect(meetsWcagAA(light.text, light.card)).toBe(true);
    expect(meetsWcagAA(light.greenText!, light.card)).toBe(true);
    expect(meetsWcagAA(light.amberText!, light.card)).toBe(true);
    expect(meetsWcagAA(light.amberSurfaceText!, light.amberSurface!)).toBe(true);
    expect(meetsWcagAA(light.crimsonText!, light.card)).toBe(true);

    // 夜テーマ
    const dark = THEME_PALETTES.dark;
    expect(meetsWcagAA(dark.text, dark.background)).toBe(true);
    expect(meetsWcagAA(dark.text, dark.card)).toBe(true);
    expect(meetsWcagAA(dark.greenText!, dark.background)).toBe(true);
    expect(meetsWcagAA(dark.greenText!, dark.card)).toBe(true);
    expect(meetsWcagAA(dark.amberText!, dark.background)).toBe(true);
    expect(meetsWcagAA(dark.amberText!, dark.card)).toBe(true);
    expect(meetsWcagAA(dark.amberSurfaceText!, dark.amberSurface!)).toBe(true);
    expect(meetsWcagAA(dark.crimsonText!, dark.background)).toBe(true);

    // スリープテーマ
    const sleep = THEME_PALETTES.sleep;
    expect(meetsWcagAA(sleep.text, sleep.background)).toBe(true);
    expect(meetsWcagAA(sleep.text, sleep.card)).toBe(true);
    expect(getContrastRatio(sleep.text, sleep.card)).toBeGreaterThanOrEqual(
      4.5
    );
  });

  it('ICON_WHITELIST の全60種が lucide-react コンポーネントとして実在すること', () => {
    expect(ICON_WHITELIST.length).toBe(60);
    for (const iconName of ICON_WHITELIST) {
      expect(WHITELIST_ICON_COMPONENTS[iconName]).toBeDefined();
    }
  });

  it('APIキー未設定時および429エラー時にアプリを止めずローカルのモックに切り替わり、リクエストURLにAPIキーが含まれないこと', async () => {
    // 1. APIキー未設定時
    const resNoKey = await runFourAiEmployeesPipeline({
      sessionAttempts: [],
      existingChunks: LV1_CORE_CHUNKS,
      settings: { ...DEFAULT_SETTINGS, geminiApiKey: undefined },
    });
    expect(resNoKey.usedMock).toBe(true);
    expect(resNoKey.newChunks.length).toBeGreaterThan(0);

    // 2. 429 Rate Limit エラー時（指数バックオフ後にモックへフォールバックし、URLにAPIキーが含まれないこと）
    const secretKey = 'AIzaTestSecretKeyFor429Check';
    const capturedUrls: string[] = [];
    const mockFetch429 = vi.fn(async (input: RequestInfo | URL) => {
      capturedUrls.push(String(input));
      return new Response('Too Many Requests', { status: 429 });
    }) as unknown as typeof fetch;

    const res429 = await runFourAiEmployeesPipeline({
      sessionAttempts: [],
      existingChunks: LV1_CORE_CHUNKS,
      settings: {
        ...DEFAULT_SETTINGS,
        level: 1,
        geminiApiKey: secretKey,
      },
      fetchImpl: mockFetch429,
      backoffBaseMs: 10,
    });

    expect(res429.usedMock).toBe(true);
    expect(res429.rateLimited).toBe(true);
    expect(capturedUrls.length).toBe(1);
    expect(capturedUrls[0]).not.toContain(secretKey);
  });

  it('TTSの onend が発火しない場合でも、(文字数 ÷ 14) ÷ 再生速度 × 1000 + 1000ms のタイムアウトで確実に onEnd が完了発火すること', async () => {
    vi.useFakeTimers();
    try {
      const text = 'Let me get a cold brew.'; // 23文字
      const rate = 1.0;
      const expectedTimeout = calculateTtsTimeoutMs(text, rate);
      expect(expectedTimeout).toBe(Math.ceil((23 / 14 / 1.0) * 1000 + 1000));

      // onend を意図的に発火させないモック speechSynthesis を設定
      const originalSpeech = window.speechSynthesis;
      const originalUtterance = globalThis.SpeechSynthesisUtterance;

      class FakeUtterance {
        text: string;
        lang = 'en-US';
        rate = 1.0;
        pitch = 1.0;
        volume = 1.0;
        onstart: (() => void) | null = null;
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(t: string) {
          this.text = t;
        }
      }

      globalThis.SpeechSynthesisUtterance =
        FakeUtterance as unknown as typeof SpeechSynthesisUtterance;
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
          cancel: vi.fn(),
          getVoices: () => [
            { lang: 'en-US', name: 'Samantha' } as SpeechSynthesisVoice,
          ],
          speak: vi.fn(), // onend を呼ばない
          addEventListener: vi.fn(),
        },
      });

      let ended = false;
      const promise = speakEnglishText({
        text,
        rate,
        onEnd: () => {
          ended = true;
        },
      });

      await vi.advanceTimersByTimeAsync(expectedTimeout + 50);
      await promise;
      expect(ended).toBe(true);

      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: originalSpeech,
      });
      globalThis.SpeechSynthesisUtterance = originalUtterance;
    } finally {
      vi.useRealTimers();
    }
  });

  it('語順ブロックを選択したときに元の位置に半透明プレースホルダーが残り（レイアウトシフト防止）、キーボード（1〜9, Backspace, Space）で操作できること', () => {
    const blocks: Block[] = [
      { id: 'b1', text: 'Let' },
      { id: 'b2', text: 'me' },
      { id: 'b3', text: 'check.' },
    ];
    const selected: string[] = ['b1'];
    const onSelect = vi.fn();
    const onUndo = vi.fn();
    const onReplay = vi.fn();

    render(
      <WordOrderBoard
        shuffledBlocks={blocks}
        selectedBlockIds={selected}
        palette={THEME_PALETTES.light}
        isAudioPlaying={false}
        onSelectBlock={onSelect}
        onUndoBlock={onUndo}
        onReplay={onReplay}
      />
    );

    // 選択済みの b1 の元のスロットに placeholder-block-b1 が存在し、他のボタン(b2, b3)のスロット位置が変わらないこと
    expect(screen.getByTestId('placeholder-block-b1')).toBeInTheDocument();
    expect(screen.getByTestId('choice-block-b2')).toBeInTheDocument();
    expect(screen.getByTestId('choice-block-b3')).toBeInTheDocument();

    // キーボード '2' で2番目のブロック（b2）が選択されること
    fireEvent.keyDown(window, { key: '2' });
    expect(onSelect).toHaveBeenCalledWith(blocks[1]);

    // キーボード 'Backspace' で1つ戻す（onUndo）が呼ばれること
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(onUndo).toHaveBeenCalled();

    // キーボード 'Space' でリプレイ（onReplay）が呼ばれること
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(onReplay).toHaveBeenCalled();
  });

  it('オフラインのままホーム画面の表示と1タップ学習開始まで問題なく動作すること', async () => {
    await clearAllStoresForTest();
    const init = await initializeAndLoadAppData();
    await saveSettingsToDb({ ...init.settings, level: 1, lv1Phase: 'blocks' });

    const originalOnLine = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    try {
      render(<App />);

      // ホーム画面の「迷ったらこれ（1タップですぐ開始）」ボタンが表示されるのを待つ
      const startBtn = await waitFor(() =>
        screen.getByTestId('one-tap-start-button')
      );
      expect(startBtn).toBeInTheDocument();

      // オフラインのまま1タップ開始をクリックし、サイレントモードの学習画面へ遷移できること
      fireEvent.click(startBtn);
      const finishBtn = await waitFor(() =>
        screen.getByTestId('finish-session-button')
      );
      expect(finishBtn).toBeInTheDocument();
    } finally {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value: originalOnLine,
      });
    }
  });
});
