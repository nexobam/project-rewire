// 昇格ゲート（語順ブロック形式限定集計）・コアセット固定・ETA例外表示・ボス戦テスト

import { describe, expect, it } from 'vitest';
import { LV1_CORE_CHUNKS, LV2_SAMPLE_CHUNKS } from '../data/seed';
import {
  buildBossQuestions,
  calculatePromotionEta,
  checkLv1PhaseTransition,
  countNewlyMasteredInLast7Days,
  evaluateBossBattle,
  evaluatePromotionGate,
  lockCoreSetForLevel,
} from '../domain/promotionGate';
import type { Attempt, Chunk } from '../types';

describe('promotionGate - 昇格ゲート・コアセット固定・ETA・ボス戦', () => {
  it('Lv.1前半（絵カード期）から後半（語順ブロック期）への移行条件（直近30問で正答率85%以上かつ緑60%以上）を正しく判定すること', () => {
    const attempts: Attempt[] = [];
    // 29問ではまだ移行しない
    for (let i = 0; i < 29; i++) {
      attempts.push({
        id: `pic_${i}`,
        chunkId: 'lv1_01',
        sessionId: 's1',
        exerciseType: 'picture_choice',
        studyDate: '2026-11-20',
        startedAt: Date.now(),
        reactionMs: 1000,
        completionMs: 1000,
        replayBeforeShown: 0,
        replayAfterShown: 0,
        rating: 'green',
        inputMode: 'silent',
        selfJudged: false,
      });
    }
    expect(checkLv1PhaseTransition(attempts).readyForBlocks).toBe(false);

    // 30問目を追加（緑20、黄6、赤4 -> 正答率 26/30 = 86.7% >= 85%, 緑 20/30 = 66.7% >= 60%）
    const thirtyMix: Attempt[] = [];
    for (let i = 0; i < 30; i++) {
      const rating = i < 20 ? 'green' : i < 26 ? 'yellow' : 'red';
      thirtyMix.push({
        id: `mix_${i}`,
        chunkId: 'lv1_01',
        sessionId: 's1',
        exerciseType: 'picture_choice',
        studyDate: '2026-11-20',
        startedAt: Date.now(),
        reactionMs: 1200,
        completionMs: 1200,
        replayBeforeShown: 0,
        replayAfterShown: 0,
        rating,
        inputMode: 'silent',
        selfJudged: false,
      });
    }
    const res = checkLv1PhaseTransition(thirtyMix);
    expect(res.readyForBlocks).toBe(true);
    expect(res.accuracyRate).toBeGreaterThanOrEqual(0.85);
    expect(res.greenRate).toBeGreaterThanOrEqual(0.6);
  });

  it('昇格ゲート①が語順ブロック形式（word_order）の評価だけで集計され、絵カードやAI追加問題が分母・分子に含まれないこと', () => {
    // AIがあとから生成した非コア問題（isCore: false）を追加しても分母（30）が変わらないことを確認
    const extraAiChunk: Chunk = {
      ...LV1_CORE_CHUNKS[0],
      id: 'ai_extra_1',
      source: 'ai',
      isCore: false,
    };
    const allChunks = [...LV1_CORE_CHUNKS, extraAiChunk];

    const attempts: Attempt[] = [];

    // 24個のコアチャンク（24/30 = 80%）について、picture_choice だけで緑を3回ずつ取ってもコア達成は 0 であること
    for (let i = 0; i < 24; i++) {
      const cid = LV1_CORE_CHUNKS[i].id;
      for (let k = 0; k < 3; k++) {
        attempts.push({
          id: `pic_only_${i}_${k}`,
          chunkId: cid,
          sessionId: 's1',
          exerciseType: 'picture_choice',
          studyDate: '2026-11-20',
          startedAt: Date.now(),
          reactionMs: 900,
          completionMs: 900,
          replayBeforeShown: 0,
          replayAfterShown: 0,
          rating: 'green',
          inputMode: 'silent',
          selfJudged: false,
        });
      }
    }

    const gateWithPictureOnly = evaluatePromotionGate({
      level: 1,
      chunks: allChunks,
      reviewStates: [],
      attempts,
    });
    expect(gateWithPictureOnly.coreTotal).toBe(30); // AI問題は分母に含まれない
    expect(gateWithPictureOnly.coreMastered).toBe(0); // 絵カード評価はカウントされない

    // 次に24個のコアチャンクについて word_order 形式で「赤 → 緑 → 緑」（直近3回中2回以上緑、かつ最新回が緑）を記録
    for (let i = 0; i < 24; i++) {
      const cid = LV1_CORE_CHUNKS[i].id;
      const seq: ('red' | 'green')[] = ['red', 'green', 'green'];
      seq.forEach((rating, idx) => {
        attempts.push({
          id: `wo_${i}_${idx}`,
          chunkId: cid,
          sessionId: 's1',
          exerciseType: 'word_order',
          studyDate: '2026-11-20',
          startedAt: Date.now(),
          reactionMs: 900,
          completionMs: 2000,
          replayBeforeShown: 0,
          replayAfterShown: 0,
          rating,
          inputMode: 'silent',
          selfJudged: false,
        });
      });
    }

    // 25個目のチャンクは「緑 → 緑 → 黄」（最新回が緑ではない）ので未達成になること
    ['green', 'green', 'yellow'].forEach((r, idx) => {
      attempts.push({
        id: `wo_24_${idx}`,
        chunkId: LV1_CORE_CHUNKS[24].id,
        sessionId: 's1',
        exerciseType: 'word_order',
        studyDate: '2026-11-20',
        startedAt: Date.now(),
        reactionMs: 900,
        completionMs: 2000,
        replayBeforeShown: 0,
        replayAfterShown: 0,
        rating: r as 'green' | 'yellow',
        inputMode: 'silent',
        selfJudged: false,
      });
    });

    // ②リスニング直近40問（85%以上＝34問以上正解）と③発話直近40回（緑75%以上＝30回以上緑）を追加
    for (let i = 0; i < 40; i++) {
      attempts.push({
        id: `sc_${i}`,
        chunkId: LV1_CORE_CHUNKS[0].id,
        sessionId: 's1',
        exerciseType: 'sound_change',
        studyDate: '2026-11-20',
        startedAt: Date.now(),
        reactionMs: 1000,
        completionMs: 1000,
        replayBeforeShown: 0,
        replayAfterShown: 0,
        rating: i < 35 ? 'green' : 'red',
        inputMode: 'silent',
        selfJudged: false,
      });
      attempts.push({
        id: `sp_${i}`,
        chunkId: LV1_CORE_CHUNKS[0].id,
        sessionId: 's1',
        exerciseType: 'speak',
        studyDate: '2026-11-20',
        startedAt: Date.now(),
        reactionMs: 1000,
        completionMs: 1000,
        replayBeforeShown: 0,
        replayAfterShown: 0,
        rating: i < 31 ? 'green' : 'yellow',
        inputMode: 'voice',
        selfJudged: true,
      });
    }

    const gatePassed = evaluatePromotionGate({
      level: 1,
      chunks: allChunks,
      reviewStates: [],
      attempts,
    });
    expect(gatePassed.coreMastered).toBe(24);
    expect(gatePassed.coreRate).toBe(0.8);
    expect(gatePassed.corePassed).toBe(true);
    expect(gatePassed.listeningPassed).toBe(true);
    expect(gatePassed.speakingPassed).toBe(true);
    expect(gatePassed.bossUnlocked).toBe(true);

    const newlyMastered = countNewlyMasteredInLast7Days({
      coreChunks: LV1_CORE_CHUNKS,
      attempts,
      currentStudyDate: '2026-11-20',
    });
    expect(newlyMastered).toBe(24);
  });

  it('Lv.2〜4への昇格時にコアセットが40チャンク（同梱サンプル5問＋再構成/AI 35問）で確定・固定されること', () => {
    const locked = lockCoreSetForLevel(2, LV2_SAMPLE_CHUNKS);
    const lv2Cores = locked.filter((c) => c.level === 2 && c.isCore);
    expect(lv2Cores.length).toBe(40);

    // 再度呼んでも40問のまま固定されること
    const lockedAgain = lockCoreSetForLevel(2, locked);
    expect(
      lockedAgain.filter((c) => c.level === 2 && c.isCore).length
    ).toBe(40);
  });

  it('ETA計算で学習日数3日未満・分母0（停滞中）・通常予測が仕様通り表示されること', () => {
    const under3Days = calculatePromotionEta({
      remainingCoreChunks: 10,
      activeStudyDatesCount: 2,
      newlyMasteredInLast7Days: 5,
    });
    expect(under3Days.days).toBeNull();
    expect(under3Days.displayText).toBe(
      'データ収集中（あと1日で予測を算出）'
    );

    const stalled = calculatePromotionEta({
      remainingCoreChunks: 10,
      activeStudyDatesCount: 5,
      newlyMasteredInLast7Days: 0,
    });
    expect(stalled.days).toBeNull();
    expect(stalled.displayText).toBe('停滞中（予測不可）');

    const normal = calculatePromotionEta({
      remainingCoreChunks: 14,
      activeStudyDatesCount: 7,
      newlyMasteredInLast7Days: 7, // 1日あたり1チャンク
    });
    expect(normal.days).toBe(14);
    expect(normal.displayText).toBe('約14日');
  });

  it('ボス戦全10問の構成比率（4問＋6問）と8問以上黄以内での合格・不合格時の24時間クールダウンが機能すること', () => {
    const questions = buildBossQuestions(1, LV1_CORE_CHUNKS);
    expect(questions.length).toBe(10);
    expect(
      questions.filter((q) => q.exerciseType === 'sound_change').length
    ).toBe(4);

    // 8問（緑5＋黄3）正解、2問赤 -> 合格
    const passOutcome = evaluateBossBattle([
      { chunkId: 'c1', rating: 'green' },
      { chunkId: 'c2', rating: 'green' },
      { chunkId: 'c3', rating: 'green' },
      { chunkId: 'c4', rating: 'green' },
      { chunkId: 'c5', rating: 'green' },
      { chunkId: 'c6', rating: 'yellow' },
      { chunkId: 'c7', rating: 'yellow' },
      { chunkId: 'c8', rating: 'yellow' },
      { chunkId: 'c9', rating: 'red' },
      { chunkId: 'c10', rating: 'red' },
    ]);
    expect(passOutcome.passed).toBe(true);
    expect(passOutcome.correctCount).toBe(8);
    expect(passOutcome.cooldownUntil).toBeUndefined();

    // 7問正解、3問赤 -> 不合格＆24時間後クールダウン
    const now = 1700000000000;
    const failOutcome = evaluateBossBattle(
      [
        { chunkId: 'c1', rating: 'green' },
        { chunkId: 'c2', rating: 'green' },
        { chunkId: 'c3', rating: 'green' },
        { chunkId: 'c4', rating: 'yellow' },
        { chunkId: 'c5', rating: 'yellow' },
        { chunkId: 'c6', rating: 'yellow' },
        { chunkId: 'c7', rating: 'yellow' },
        { chunkId: 'c8', rating: 'red' },
        { chunkId: 'c9', rating: 'red' },
        { chunkId: 'c10', rating: 'red' },
      ],
      now
    );
    expect(failOutcome.passed).toBe(false);
    expect(failOutcome.failedChunkIds).toEqual(['c8', 'c9', 'c10']);
    expect(failOutcome.cooldownUntil).toBe(now + 24 * 60 * 60 * 1000);
  });
});
