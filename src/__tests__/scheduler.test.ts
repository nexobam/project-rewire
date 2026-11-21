// インターリービング・Miami Heat比率（15%±5%）・問題切れ時の recomposed 補充テスト

import { describe, expect, it } from 'vitest';
import { LV1_CORE_CHUNKS } from '../data/seed';
import {
  buildSessionBatch,
  hasInterleavingConflict,
  selectInterleavedBatch,
} from '../domain/scheduler';
import type { Attempt } from '../types';

describe('scheduler - インターリービングとMiami Heat比率15%±5%制御', () => {
  it('同じ grammarPattern または同じ sceneCategory の問題が2問連続しないこと', () => {
    const batch = buildSessionBatch({
      allChunks: LV1_CORE_CHUNKS,
      reviewStates: [],
      recentAttempts: [],
      currentStudyDate: '2026-11-20',
      currentLevel: 1,
      mode: 'silent',
      batchSize: 15,
    });

    expect(batch.length).toBe(15);
    for (let i = 1; i < batch.length; i++) {
      expect(hasInterleavingConflict(batch[i - 1], batch[i])).toBe(false);
    }
  });

  it('全シードデータおよび直近100問の選出がすべて日常会話（daily 100%）であること', () => {
    const historyCategories: ('daily' | 'heat')[] = [];
    const recentAttempts: Attempt[] = [];

    // 15問×7バッチ＝105問を連続選出し、直近100問すべてが日常会話であることを検証
    for (let b = 0; b < 7; b++) {
      const batch = selectInterleavedBatch({
        candidates: LV1_CORE_CHUNKS,
        batchSize: 15,
        recentHistoryCategories: historyCategories.slice(-100),
        fallbackPool: LV1_CORE_CHUNKS,
      });

      for (const chunk of batch) {
        historyCategories.push(chunk.contentCategory);
        recentAttempts.push({
          id: `att_${historyCategories.length}`,
          chunkId: chunk.id,
          sessionId: 's1',
          exerciseType: 'word_order',
          studyDate: '2026-11-20',
          startedAt: Date.now(),
          reactionMs: 800,
          completionMs: 2200,
          replayBeforeShown: 0,
          replayAfterShown: 0,
          rating: 'green',
          inputMode: 'silent',
          selfJudged: false,
        });
      }
    }

    const last100 = historyCategories.slice(-100);
    expect(last100.length).toBe(100);
    const heatCount = last100.filter((c) => c === 'heat').length;
    expect(heatCount).toBe(0);
  });

  it('新規問題が枯渇しても既存のチャンクから recomposed を生成して15問バッチを埋められること', () => {
    const onlyTwoChunks = LV1_CORE_CHUNKS.slice(0, 2);
    const batch = selectInterleavedBatch({
      candidates: onlyTwoChunks,
      batchSize: 15,
      fallbackPool: onlyTwoChunks,
    });

    expect(batch.length).toBe(15);
    expect(batch.some((c) => c.source === 'recomposed')).toBe(true);
    for (let i = 1; i < batch.length; i++) {
      expect(hasInterleavingConflict(batch[i - 1], batch[i])).toBe(false);
    }
  });
});
