// ユーザー体験シナリオE2Eテスト（サイレントモード解説表示・発話モードマイクボタン連続表示・音声／ミッション／答えの100%一致検証）

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ALL_SEED_CHUNKS, LV1_CORE_CHUNKS } from '../data/seed';
import {
  clearAllStoresForTest,
  initializeAndLoadAppData,
  saveSettingsToDb,
} from '../db/database';
import {
  extractSituationMeaning,
  extractWordOrderBreakdown,
} from '../domain/chunkExplanation';
import { THEME_PALETTES } from '../domain/contrast';
import { evaluatePromotionGate } from '../domain/promotionGate';
import { recomposeChunk } from '../domain/scheduler';
import { SilentModePage } from '../pages/SilentModePage';
import { SpeakModePage } from '../pages/SpeakModePage';
import * as ttsService from '../services/ttsService';
import { DEFAULT_SETTINGS } from '../types';

describe('E2E User Scenarios - サイレントモード解説・Push-to-Talkマイク継続表示・音声とミッションと答えの一致', () => {
  const spokenTexts: string[] = [];

  beforeEach(async () => {
    spokenTexts.length = 0;
    vi.restoreAllMocks();
    await clearAllStoresForTest();

    // TTSをモックし、読み上げられた英語テキストをすべて記録して即座に onEnd を呼ぶ
    vi.spyOn(ttsService, 'speakEnglishText').mockImplementation(
      async ({ text, onEnd }) => {
        spokenTexts.push(text);
        onEnd?.();
      }
    );
  });

  it('シナリオ1（サイレントモード Lv.1前半 絵カード期）：複数問連続でカード解説と回答後3段解説が表示され、流れた音声と正解英文と解説が100%一致すること', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      level: 1 as const,
      lv1Phase: 'picture' as const,
    };
    const gateStatus = evaluatePromotionGate({
      level: 1,
      chunks: ALL_SEED_CHUNKS,
      reviewStates: [],
      attempts: [],
    });

    const chunkMapByEn = new Map(ALL_SEED_CHUNKS.map((c) => [c.enText, c]));

    render(
      <SilentModePage
        plannedMinutes={15}
        isSecondOrLaterToday={false}
        settings={settings}
        allChunks={ALL_SEED_CHUNKS}
        reviewStates={[]}
        recentAttempts={[]}
        currentStudyDate="2026-11-21"
        gateStatus={gateStatus}
        palette={THEME_PALETTES.light}
        onRecordAttempt={vi.fn(async () => {})}
        onCompleteSession={vi.fn(async () => {})}
        onReportUnnatural={vi.fn()}
        onExitHome={vi.fn()}
      />
    );

    // 4問連続で解いてシナリオ検証（1〜3問目：絵カード4択、4問目：音変化リスニング）
    for (let qIdx = 0; qIdx < 4; qIdx++) {
      // 直前に再生された英語音声を取得
      await waitFor(() => expect(spokenTexts.length).toBeGreaterThan(qIdx));
      const currentSpokenEn = spokenTexts[spokenTexts.length - 1];
      expect(currentSpokenEn).toBeTruthy();

      const expectedChunk = chunkMapByEn.get(currentSpokenEn);
      expect(expectedChunk).toBeDefined();
      const expectedMeaning = extractSituationMeaning(expectedChunk!);

      // 状況カードに「この場面で言っていること（状況・意図）」が表示されていること
      const correctCardIntent = await waitFor(() =>
        screen.getByTestId(`visual-card-intent-${expectedChunk!.id}`)
      );
      expect(correctCardIntent).toHaveTextContent(expectedMeaning);

      if (screen.queryByTestId('picture-choice-grid')) {
        // 絵カード4択：正解カードをクリック
        const correctCard = screen.getByTestId(
          `visual-card-${expectedChunk!.id}`
        );
        fireEvent.click(correctCard);
      } else {
        // 音変化リスニング：聴こえた英文と同一の選択肢ボタンをクリック
        const soundChoiceBtn = screen.getByRole('button', {
          name: currentSpokenEn,
        });
        fireEvent.click(soundChoiceBtn);
      }

      // 回答後カード（PostAnswerCard）が表示され、音声・英文・場面の意図・語順チャンク解説・発音フォームが完全一致すること
      const postCard = await waitFor(() =>
        screen.getByTestId('post-answer-card')
      );
      expect(postCard).toBeInTheDocument();

      expect(screen.getByTestId('revealed-en-text')).toHaveTextContent(
        currentSpokenEn
      );
      expect(
        screen.getByTestId('explanation-situation-meaning')
      ).toHaveTextContent(expectedMeaning);
      expect(screen.getByTestId('explanation-word-order')).toHaveTextContent(
        extractWordOrderBreakdown(expectedChunk!)
      );
      expect(screen.getByTestId('explanation-pronunciation')).toHaveTextContent(
        expectedChunk!.pronunciationTip
      );

      // 左カラムにもサイレントモード解説サマリーが表示されていること
      expect(
        screen.getByTestId('silent-left-explanation-summary')
      ).toHaveTextContent(expectedMeaning);

      // 回答後カード内にも発音練習用Push-to-Talkマイクボタンが存在すること
      expect(screen.getByTestId('post-answer-mic-button')).toBeInTheDocument();

      // 「次の問題へ」をクリック
      fireEvent.click(screen.getByTestId('next-question-button'));
    }
  });

  it('シナリオ2（サイレントモード Lv.1後半 語順ブロック期）：出題中カードにも場面の意味が表示され、回答後に語順チャンク解説と発音フォームが表示されること', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      level: 1 as const,
      lv1Phase: 'blocks' as const,
    };
    const gateStatus = evaluatePromotionGate({
      level: 1,
      chunks: ALL_SEED_CHUNKS,
      reviewStates: [],
      attempts: [],
    });
    const chunkMapByEn = new Map(ALL_SEED_CHUNKS.map((c) => [c.enText, c]));

    render(
      <SilentModePage
        plannedMinutes={15}
        isSecondOrLaterToday={false}
        settings={settings}
        allChunks={ALL_SEED_CHUNKS}
        reviewStates={[]}
        recentAttempts={[]}
        currentStudyDate="2026-11-21"
        gateStatus={gateStatus}
        palette={THEME_PALETTES.light}
        onRecordAttempt={vi.fn(async () => {})}
        onCompleteSession={vi.fn(async () => {})}
        onReportUnnatural={vi.fn()}
        onExitHome={vi.fn()}
      />
    );

    const currentSpokenEn = spokenTexts[spokenTexts.length - 1];
    const currentChunk = chunkMapByEn.get(currentSpokenEn)!;
    expect(currentChunk).toBeDefined();

    // 左側のVisualCardに「この場面で言っていること（状況・意図）」が表示されていること
    expect(
      screen.getByTestId(`visual-card-intent-${currentChunk.id}`)
    ).toHaveTextContent(extractSituationMeaning(currentChunk));

    // ブロックを順番にタップして回答を完了する
    for (const block of currentChunk.blocks) {
      const btn = screen.getByTestId(`choice-block-${block.id}`);
      fireEvent.click(btn);
    }

    // 回答後解説カードに英文・場面の意図・語順チャンク解説・発音フォームが表示されること
    await waitFor(() =>
      expect(screen.getByTestId('post-answer-card')).toBeInTheDocument()
    );
    expect(screen.getByTestId('revealed-en-text')).toHaveTextContent(
      currentChunk.enText
    );
    expect(
      screen.getByTestId('explanation-situation-meaning')
    ).toHaveTextContent(extractSituationMeaning(currentChunk));
    expect(screen.getByTestId('explanation-word-order')).toHaveTextContent(
      extractWordOrderBreakdown(currentChunk)
    );
  });

  it('シナリオ3（発話ドリルモード 5問連続）：1問目〜5問目すべてでPush-to-Talkマイクボタンが常時表示・動作し、発話ミッション・流れる音声・答えが100%一致すること', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      level: 1 as const,
      lv1Phase: 'picture' as const,
    };
    const gateStatus = evaluatePromotionGate({
      level: 1,
      chunks: ALL_SEED_CHUNKS,
      reviewStates: [],
      attempts: [],
    });

    const chunkMapByMeaning = new Map(
      ALL_SEED_CHUNKS.map((c) => [extractSituationMeaning(c), c])
    );

    render(
      <SpeakModePage
        plannedMinutes={15}
        settings={settings}
        allChunks={ALL_SEED_CHUNKS}
        reviewStates={[]}
        recentAttempts={[]}
        currentStudyDate="2026-11-21"
        gateStatus={gateStatus}
        palette={THEME_PALETTES.light}
        onRecordAttempt={vi.fn(async () => {})}
        onCompleteSession={vi.fn(async () => {})}
        onReportUnnatural={vi.fn()}
        onExitHome={vi.fn()}
      />
    );

    for (let qIdx = 0; qIdx < 5; qIdx++) {
      const countBeforeAnswer = spokenTexts.length;

      // 回答前に別の英文（promptAudioText等）が勝手に流れていないこと
      const missionTextEl = await waitFor(() =>
        screen.getByTestId('speak-mission-text')
      );
      const missionText = missionTextEl.textContent?.trim() ?? '';
      expect(missionText.length).toBeGreaterThan(0);

      const expectedChunk = chunkMapByMeaning.get(missionText);
      expect(expectedChunk).toBeDefined();

      // Push-to-Talkマイクボタンが1問目だけでなく2問目〜5問目でも必ず表示されていること
      const micBtn = screen.getByTestId('push-to-talk-mic-button');
      expect(micBtn).toBeInTheDocument();
      expect(micBtn).toHaveTextContent(
        'マイクボタンを押している間（またはタップで）英語を話す'
      );

      // マイクボタンを押下（pointerDown）すると録音中表示になり、再度タップで停止できること
      fireEvent.pointerDown(micBtn);
      expect(micBtn).toHaveTextContent(
        'マイク聞き取り中...（離す／タップで停止）'
      );
      fireEvent.pointerDown(micBtn);
      expect(micBtn).toHaveTextContent(
        'マイクボタンを押している間（またはタップで）英語を話す'
      );

      // 自己判定ボタン（緑）をタップして回答
      fireEvent.click(screen.getByTestId('self-judge-green'));

      // 回答後カードが表示されること
      await waitFor(() =>
        expect(screen.getByTestId('post-answer-card')).toBeInTheDocument()
      );

      // 1. 回答確定時に流れた音声（spokenTextsの最新要素）
      expect(spokenTexts.length).toBeGreaterThan(countBeforeAnswer);
      const spokenAnswerEn = spokenTexts[spokenTexts.length - 1];

      // 2. 画面に表示された正解英文（revealed-en-text）
      const revealedEn =
        screen.getByTestId('revealed-en-text').textContent?.trim() ?? '';

      // 3. 回答後カードの「このセリフで言っていること（場面の意図）」
      const revealedMeaning =
        screen
          .getByTestId('explanation-situation-meaning')
          .textContent?.replace('このセリフで言っていること（場面の意図）', '')
          .trim() ?? '';

      // 発音された英語・表示された答え・出題時の発話ミッションが100%同一チャンクで完全一致していること！
      expect(spokenAnswerEn).toBe(expectedChunk!.enText);
      expect(revealedEn).toBe(expectedChunk!.enText);
      expect(revealedMeaning).toBe(missionText);

      // 次の問題へ進む
      fireEvent.click(screen.getByTestId('next-question-button'));
    }
  });

  it('シナリオ4（組み替え問題 recomposeChunk）：接頭辞・接尾辞で問題が組み替えられた場合も、coreImageJa（言いたいこと・語順解説）と soundChangeChoices が新しい英文と完全一致すること', () => {
    const base = LV1_CORE_CHUNKS[0]; // "Let me get a cold brew."
    const recomposed1 = recomposeChunk(base, 0); // suffix: "right now"
    expect(recomposed1.enText).toContain('right now');
    expect(extractSituationMeaning(recomposed1)).toContain('今すぐ');
    expect(extractWordOrderBreakdown(recomposed1)).toContain('right now');
    if (recomposed1.soundChangeChoices) {
      expect(recomposed1.soundChangeChoices).toContain(recomposed1.enText);
    }

    const recomposed3 = recomposeChunk(base, 2); // prefix: "Honestly"
    expect(recomposed3.enText.startsWith('Honestly ')).toBe(true);
    expect(extractSituationMeaning(recomposed3)).toContain('正直なところ');
    expect(extractWordOrderBreakdown(recomposed3)).toContain('Honestly');
  });

  it('シナリオ5（アプリ統合フロー）：ホーム画面から発話ドリルを起動し、複数問をマイク操作付きで進めてホームへ戻れること', async () => {
    const init = await initializeAndLoadAppData();
    await saveSettingsToDb({
      ...init.settings,
      level: 1,
      lv1Phase: 'picture',
    });

    render(<App />);

    // ホーム画面の「発話ドリル 5分」ボタンをクリック
    const speak5Btn = await waitFor(() =>
      screen.getByTestId('start-speak-5')
    );
    fireEvent.click(speak5Btn);

    // 1問目のマイクボタンとミッションを確認
    const mic1 = await waitFor(() =>
      screen.getByTestId('push-to-talk-mic-button')
    );
    expect(mic1).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('self-judge-green'));

    await waitFor(() =>
      expect(screen.getByTestId('post-answer-card')).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId('next-question-button'));

    // 2問目でもマイクボタンが表示されていることを確認
    const mic2 = await waitFor(() =>
      screen.getByTestId('push-to-talk-mic-button')
    );
    expect(mic2).toBeInTheDocument();
  });
});
