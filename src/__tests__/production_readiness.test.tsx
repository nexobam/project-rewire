// 本番運用向けエッジケース・シナリオ網羅テスト（4名レビュー指摘事項の再発防止）

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index';
import { ALL_SEED_CHUNKS } from '../data/seed';
import { THEME_PALETTES } from '../domain/contrast';
import { parseLiveSessionLog } from '../domain/liveParser';
import {
  evaluatePromotionGate,
  lockCoreSetForLevel,
} from '../domain/promotionGate';
import { evaluateStreakAndTickets } from '../domain/studyDate';
import { mergeCloudAndLocalStores } from '../hooks/useAppStore';
import { BossBattlePage } from '../pages/BossBattlePage';
import { CoachChatPage } from '../pages/CoachChatPage';
import { SettingsPage } from '../pages/SettingsPage';
import { SilentModePage } from '../pages/SilentModePage';
import { SpeakModePage } from '../pages/SpeakModePage';
import { askAiCoachQuestion } from '../services/geminiService';
import {
  clearActiveProfile,
  getActiveProfile,
  INACTIVITY_LOGOUT_MS,
  selectActiveProfile,
} from '../services/profileService';
import { DEFAULT_SETTINGS, type Attempt, type Chunk, type Session } from '../types';

describe('本番運用エッジケース & シナリオ検証', () => {
  it('お休みチケットを2枚消費して2日間休んだ場合でも、ストリークが二重消費で0にならないこと', () => {
    // 11/16(月)に学習し、11/17(火)・11/18(水)の2日休んで11/19(木)に開いたケース
    const res = evaluateStreakAndTickets({
      currentStudyDate: '2026-11-19',
      activeStudyDates: ['2026-11-16'],
      currentTickets: 2,
      lastTicketRefillWeek: '2026-11-16',
      lastEvaluatedStudyDate: '2026-11-17',
    });
    expect(res.restTickets).toBe(0);
    expect(res.streakDays).toBe(1);
    expect(res.suggestRehab).toBe(true);
  });

  it('Lv.2昇格後は levelPromotedAt 以前の Lv.1 リスニング・発話実績が持ち越されず、isSleepPriming も除外されること', () => {
    const promotedAt = 1_700_000_000_000;
    const oldLv1Attempts: Attempt[] = Array.from({ length: 40 }, (_, i) => ({
      id: `old_${i}`,
      chunkId: 'lv1_01',
      sessionId: 's_old',
      exerciseType: i % 2 === 0 ? 'sound_change' : 'speak',
      studyDate: '2026-11-10',
      startedAt: promotedAt - 100_000 + i,
      reactionMs: 500,
      completionMs: 1000,
      replayBeforeShown: 0,
      replayAfterShown: 0,
      rating: 'green',
      inputMode: i % 2 === 0 ? 'silent' : 'voice',
      selfJudged: i % 2 !== 0,
    }));

    const sleepAttempt: Attempt = {
      id: 'sleep_1',
      chunkId: 'lv2_01',
      sessionId: 's_sleep',
      exerciseType: 'speak',
      studyDate: '2026-11-20',
      startedAt: promotedAt + 5000,
      reactionMs: null,
      completionMs: null,
      replayBeforeShown: 0,
      replayAfterShown: 0,
      rating: 'green',
      inputMode: 'silent',
      selfJudged: true,
      isSleepPriming: true,
    };

    const gate = evaluatePromotionGate({
      level: 2,
      chunks: ALL_SEED_CHUNKS,
      reviewStates: [],
      attempts: [...oldLv1Attempts, sleepAttempt],
      levelPromotedAt: promotedAt,
    });

    expect(gate.listeningSampled).toBe(0);
    expect(gate.speakingSampled).toBe(0);
    expect(gate.listeningPassed).toBe(false);
    expect(gate.speakingPassed).toBe(false);
  });

  it('lockCoreSetForLevel(2) が重複英文を極力排して40問のコアセットを生成すること', () => {
    const locked = lockCoreSetForLevel(2, ALL_SEED_CHUNKS);
    const lv2Cores = locked.filter((c) => c.level === 2 && c.isCore && !c.disabled);
    expect(lv2Cores.length).toBe(40);
    const uniqueTexts = new Set(lv2Cores.map((c) => c.enText.trim().toLowerCase()));
    expect(uniqueTexts.size).toBeGreaterThanOrEqual(30);
  });

  it('mergeCloudAndLocalStores がオフライン学習データ（ローカルのみの attempt / session）を消失させないこと', () => {
    const localAttempt: Attempt = {
      id: 'att_offline_1',
      chunkId: 'lv1_01',
      sessionId: 'sess_offline_1',
      exerciseType: 'word_order',
      studyDate: '2026-11-21',
      startedAt: 2000,
      reactionMs: 400,
      completionMs: 1200,
      replayBeforeShown: 0,
      replayAfterShown: 0,
      rating: 'green',
      inputMode: 'silent',
      selfJudged: false,
    };
    const localSession: Session = {
      id: 'sess_offline_1',
      mode: 'silent',
      plannedMinutes: 15,
      activeSeconds: 180,
      studyDate: '2026-11-21',
      startedAt: 1000,
      endedAt: 2000,
    };

    const { merged, hasLocalOnlyChanges } = mergeCloudAndLocalStores(
      {
        settings: { ...DEFAULT_SETTINGS, level: 2 },
        chunks: ALL_SEED_CHUNKS,
        reviewStates: [],
        attempts: [localAttempt],
        sessions: [localSession],
        aiReports: [],
        coachMessages: [],
      },
      {
        settings: { ...DEFAULT_SETTINGS, level: 1 },
        chunks: ALL_SEED_CHUNKS,
        reviewStates: [],
        attempts: [],
        sessions: [],
        aiReports: [],
        coachMessages: [],
      }
    );

    expect(hasLocalOnlyChanges).toBe(true);
    expect(merged.settings.level).toBe(2);
    expect(merged.attempts.some((a) => a.id === 'att_offline_1')).toBe(true);
    expect(merged.sessions.some((s) => s.id === 'sess_offline_1')).toBe(true);
  });

  it('AIコーチフォールバックが「最高」単独でヒート応援を誤爆せず、「ヒート最高」にはヒート表現を返すこと', async () => {
    const heatRes = await askAiCoachQuestion({
      question: 'ヒート最高ってなんて言えばいい？',
      settings: { ...DEFAULT_SETTINGS, geminiApiKey: '' },
    });
    expect(heatRes.answer).toContain('ヒート');
    expect(heatRes.examples.join(' ')).toContain('Heat');

    const generalRes = await askAiCoachQuestion({
      question: '最高の一日だったって英語でどう言う？',
      settings: { ...DEFAULT_SETTINGS, geminiApiKey: '' },
    });
    expect(generalRes.examples.join(' ')).not.toContain('Heat are on fire');
  });

  it('Liveログの前置き雑談に {name} 等が含まれていても有効な後続JSONを抽出し、記号ゴミは除外すること', () => {
    const raw = `Sure {user}, here is your log: {"durationMinutes": 20, "overallReview": "Good job", "goodPoints": ["fast"], "badPoints": ["none"], "fluencyScore": 4, "weakChunks": ["...", "on my way"]}`;
    const parsed = parseLiveSessionLog(raw, 1);
    expect(parsed.calendarMinutes).toBe(20);
    expect(parsed.generatedChunks).toHaveLength(1);
    expect(parsed.generatedChunks[0].enText).toBe('on my way');
  });

  it('Worker は APP_PASSCODE 未設定時に Fail-Closed（401/503）になり、gemini-3.8-flash へ thinkingBudget を送らないこと', async () => {
    const createStmt = () => {
      const stmt = {
        bind: () => stmt,
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
      };
      return stmt;
    };
    const noPassEnv = {
      DB: {
        prepare: () => createStmt(),
      },
      ASSETS: { fetch: vi.fn(async () => new Response('ok')) },
      GEMINI_API_KEY: 'test-key',
      APP_PASSCODE: '',
    };
    const syncRes = await worker.fetch(
      new Request('https://example.workers.dev/api/sync'),
      noPassEnv
    );
    expect(syncRes.status).toBe(401);

    const verifyRes = await worker.fetch(
      new Request('https://example.workers.dev/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ passcode: 'anything' }),
      }),
      noPassEnv
    );
    expect(verifyRes.status).toBe(503);

    // gemini-3.8-flash へ thinkingBudget を送らないことの確認
    let sentBody = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      sentBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await worker.fetch(
        new Request('https://example.workers.dev/api/gemini', {
          method: 'POST',
          headers: { 'X-App-Passcode': 'secret' },
          body: JSON.stringify({ model: 'gemini-3.8-flash', userPrompt: 'hi' }),
        }),
        { ...noPassEnv, APP_PASSCODE: 'secret' }
      );
      expect(sentBody).not.toContain('thinkingBudget');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('SilentModePage / SpeakModePage / BossBattlePage が問題0件でもクラッシュせず戻る画面を出すこと', () => {
    const emptyChunks: Chunk[] = [];
    const noopAsync = vi.fn(async () => {});
    const onExit = vi.fn();

    const r1 = render(
      <SilentModePage
        plannedMinutes={3}
        isSecondOrLaterToday={false}
        settings={{ ...DEFAULT_SETTINGS, level: 1 }}
        allChunks={emptyChunks}
        reviewStates={[]}
        recentAttempts={[]}
        currentStudyDate="2026-11-21"
        gateStatus={{
          level: 1,
          coreTotal: 30,
          coreMastered: 0,
          coreRate: 0,
          corePassed: false,
          listeningSampled: 0,
          listeningRate: 0,
          listeningPassed: false,
          speakingSampled: 0,
          speakingGreenRate: 0,
          speakingPassed: false,
          bossUnlocked: false,
        }}
        palette={THEME_PALETTES.light}
        onRecordAttempt={noopAsync}
        onCompleteSession={noopAsync}
        onReportUnnatural={vi.fn()}
        onExitHome={onExit}
      />
    );
    expect(screen.getByText(/出題できる問題がありません/)).toBeInTheDocument();
    r1.unmount();

    const r2 = render(
      <SpeakModePage
        plannedMinutes={5}
        settings={{ ...DEFAULT_SETTINGS, level: 1 }}
        allChunks={emptyChunks}
        reviewStates={[]}
        recentAttempts={[]}
        currentStudyDate="2026-11-21"
        gateStatus={{
          level: 1,
          coreTotal: 30,
          coreMastered: 0,
          coreRate: 0,
          corePassed: false,
          listeningSampled: 0,
          listeningRate: 0,
          listeningPassed: false,
          speakingSampled: 0,
          speakingGreenRate: 0,
          speakingPassed: false,
          bossUnlocked: false,
        }}
        palette={THEME_PALETTES.dark}
        onRecordAttempt={noopAsync}
        onCompleteSession={noopAsync}
        onReportUnnatural={vi.fn()}
        onExitHome={onExit}
      />
    );
    expect(screen.getByText(/出題できる問題がありません/)).toBeInTheDocument();
    r2.unmount();

    render(
      <BossBattlePage
        settings={{ ...DEFAULT_SETTINGS, level: 1 }}
        allChunks={emptyChunks}
        currentStudyDate="2026-11-21"
        palette={THEME_PALETTES.light}
        onRecordAttempt={noopAsync}
        onPassBoss={noopAsync}
        onFailBoss={noopAsync}
        onExitHome={onExit}
      />
    );
    expect(screen.getByText(/ボス戦に出題できる問題が見つかりませんでした/)).toBeInTheDocument();
  });

  it('SettingsPage で perTapMs を自由に入力し直せ、不要なバックアップ/APIキー欄が表示されないこと', () => {
    const onUpdate = vi.fn(async (patch) => ({ ...DEFAULT_SETTINGS, ...patch }));

    render(
      <SettingsPage
        settings={DEFAULT_SETTINGS}
        palette={THEME_PALETTES.light}
        onUpdateSettings={onUpdate}
        onStartRecalibration={vi.fn()}
      />
    );

    expect(
      screen.queryByTestId('settings-export-backup-button')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('settings-gemini-key-input')
    ).not.toBeInTheDocument();

    const input = screen.getByLabelText('perTapMs') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: '450' } });
    fireEvent.blur(input);
    expect(onUpdate).toHaveBeenCalledWith({ perTapMs: 450 });
  });

  it('CoachChatPage はオフラインやAI未接続（usedMock: true）のとき偽の回答を answered として保存しないこと', async () => {
    const onUpsert = vi.fn(async () => {});
    render(
      <CoachChatPage
        settings={{ ...DEFAULT_SETTINGS, geminiApiKey: '' }}
        messages={[]}
        palette={THEME_PALETTES.light}
        serverHasGeminiKey={false}
        onUpsertMessage={onUpsert}
      />
    );

    expect(screen.getByTestId('ai-coach-connection-badge')).toHaveTextContent(
      'オフライン / AI未接続（回答停止中）'
    );

    fireEvent.change(screen.getByTestId('coach-question-input'), {
      target: { value: 'ヒート最高ってなんて言う？' },
    });
    fireEvent.click(screen.getByTestId('coach-send-button'));

    await vi.waitFor(() => {
      expect(screen.getByTestId('coach-error-banner')).toBeInTheDocument();
    });
    // answered として偽回答が保存されていないこと
    expect(onUpsert).not.toHaveBeenCalled();
  });

  it('使用者プロファイル（M / Y）は14日間アクセスがないと自動ログアウトし、Worker D1 も M と Y で完全分離されること', async () => {
    clearActiveProfile();
    expect(getActiveProfile(1000)).toBeNull();

    // M を選択して13日後までは有効、14日経過で自動ログアウト
    selectActiveProfile('M', 1_000_000);
    expect(getActiveProfile(1_000_000 + INACTIVITY_LOGOUT_MS - 1000)).toBe('M');
    // 最終アクセス時刻が更新されたのでそこから14日後にログアウト
    const lastActive = 1_000_000 + INACTIVITY_LOGOUT_MS - 1000;
    expect(getActiveProfile(lastActive + INACTIVITY_LOGOUT_MS)).toBeNull();

    // Worker 側でも M と Y の保存データが分離されること
    const rows = new Map<string, { store_key: string; data_json: string; updated_at: number }>();
    const env = {
      DB: {
        prepare(query: string) {
          let bound: unknown[] = [];
          const stmt = {
            bind(...values: unknown[]) {
              bound = values;
              return stmt;
            },
            first: async () => null,
            all: async () => ({ results: [...rows.values()] as never[] }),
            run: async () => {
              if (query.includes('INSERT INTO sync_store')) {
                const [key, json, ts] = bound as [string, string, number];
                rows.set(key, { store_key: key, data_json: json, updated_at: ts });
              }
              return { success: true };
            },
          };
          return stmt;
        },
      },
      ASSETS: { fetch: vi.fn(async () => new Response('ok')) },
      GEMINI_API_KEY: 'test-key',
      APP_PASSCODE: 'secret',
    };

    await worker.fetch(
      new Request('https://example.workers.dev/api/sync?profile=M', {
        method: 'PUT',
        headers: { 'X-App-Passcode': 'secret', 'X-App-Profile': 'M' },
        body: JSON.stringify({ stores: { attempts: [{ id: 'm_att_1' }] } }),
      }),
      env
    );
    await worker.fetch(
      new Request('https://example.workers.dev/api/sync?profile=Y', {
        method: 'PUT',
        headers: { 'X-App-Passcode': 'secret', 'X-App-Profile': 'Y' },
        body: JSON.stringify({ stores: { attempts: [{ id: 'y_att_1' }] } }),
      }),
      env
    );

    const getM = (await (
      await worker.fetch(
        new Request('https://example.workers.dev/api/sync?profile=M', {
          headers: { 'X-App-Passcode': 'secret', 'X-App-Profile': 'M' },
        }),
        env
      )
    ).json()) as { stores: { attempts: { id: string }[] } };
    const getY = (await (
      await worker.fetch(
        new Request('https://example.workers.dev/api/sync?profile=Y', {
          headers: { 'X-App-Passcode': 'secret', 'X-App-Profile': 'Y' },
        }),
        env
      )
    ).json()) as { stores: { attempts: { id: string }[] } };

    expect(getM.stores.attempts).toEqual([{ id: 'm_att_1' }]);
    expect(getY.stores.attempts).toEqual([{ id: 'y_att_1' }]);
  });

  it('SilentModePage で連続して問題を進めても、再生音声・選択肢の正解・回答後正解英文が常に100%一致すること', async () => {
    const spokenTexts: string[] = [];
    const originalSpeech = window.speechSynthesis;
    const originalUtterance = globalThis.SpeechSynthesisUtterance;

    class MockUtterance {
      text: string;
      lang = 'en-US';
      rate = 1;
      pitch = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    globalThis.SpeechSynthesisUtterance =
      MockUtterance as unknown as typeof SpeechSynthesisUtterance;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speaking: false,
        pending: false,
        getVoices: () => [{ lang: 'en-US', name: 'Samantha' }],
        cancel: vi.fn(),
        speak: vi.fn((utt: MockUtterance) => {
          spokenTexts.push(utt.text);
          setTimeout(() => {
            utt.onstart?.();
            utt.onend?.();
          }, 0);
        }),
        addEventListener: vi.fn(),
      },
    });

    try {
      const lv1Chunks = ALL_SEED_CHUNKS.filter((c) => c.level === 1);
      render(
        <SilentModePage
          plannedMinutes={3}
          isSecondOrLaterToday={false}
          settings={{ ...DEFAULT_SETTINGS, level: 1, lv1Phase: 'picture' }}
          allChunks={lv1Chunks}
          reviewStates={[]}
          recentAttempts={[]}
          currentStudyDate="2026-11-21"
          gateStatus={{
            level: 1,
            coreTotal: 30,
            coreMastered: 0,
            coreRate: 0,
            corePassed: false,
            listeningSampled: 0,
            listeningRate: 0,
            listeningPassed: false,
            speakingSampled: 0,
            speakingGreenRate: 0,
            speakingPassed: false,
            bossUnlocked: false,
          }}
          palette={THEME_PALETTES.light}
          onRecordAttempt={vi.fn(async () => {})}
          onCompleteSession={vi.fn(async () => {})}
          onReportUnnatural={vi.fn()}
          onExitHome={vi.fn()}
        />
      );

      for (let q = 0; q < 3; q++) {
        await vi.waitFor(() => {
          expect(screen.getByTestId('picture-choice-grid')).toBeInTheDocument();
        });
        const currentSpoken = spokenTexts[spokenTexts.length - 1];
        expect(currentSpoken).toBeTruthy();

        const grid = screen.getByTestId('picture-choice-grid');
        const cardButtons = grid.querySelectorAll('[data-testid^="visual-card-"]');
        expect(cardButtons.length).toBe(4);
        fireEvent.click(cardButtons[0]);

        await vi.waitFor(() => {
          expect(screen.getByTestId('revealed-en-text')).toBeInTheDocument();
        });
        expect(screen.getByTestId('revealed-en-text')).toHaveTextContent(
          currentSpoken
        );

        fireEvent.click(screen.getByTestId('next-question-button'));
      }
    } finally {
      Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: originalSpeech,
      });
      globalThis.SpeechSynthesisUtterance = originalUtterance;
    }
  });
});
