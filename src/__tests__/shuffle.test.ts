// 厳密シャッフルテスト（1万回試行して acceptableOrders と1度も一致しないこと・重複単語を含む場合も）

import { describe, expect, it } from 'vitest';
import { strictShuffleBlocks } from '../domain/shuffle';
import { isAcceptableWordOrder } from '../domain/timingJudge';
import type { Block } from '../types';

describe('shuffle - 1万回試行の厳密シャッフル保証', () => {
  it('通常の文および複数正解（acceptableOrders）がある文で10,000回試行しても正解並びと1度も一致しないこと', () => {
    const blocks: Block[] = [
      { id: 'b0', text: 'I' },
      { id: 'b1', text: 'will' },
      { id: 'b2', text: 'let' },
      { id: 'b3', text: 'you' },
      { id: 'b4', text: 'know' },
      { id: 'b5', text: 'tomorrow.' },
    ];
    const acceptableOrders = [
      ['I', 'will', 'let', 'you', 'know', 'tomorrow.'],
      ['tomorrow.', 'I', 'will', 'let', 'you', 'know'],
    ];

    for (let i = 0; i < 10000; i++) {
      const shuffled = strictShuffleBlocks(blocks, acceptableOrders);
      const textOrder = shuffled.map((b) => b.text);
      expect(isAcceptableWordOrder(textOrder, acceptableOrders)).toBe(false);
    }
  });

  it('同じ単語が重複している文（例: "that" が2回出現）でもブロックIDが保持され、10,000回試行して正解の並びと1度も一致しないこと', () => {
    const duplicateWordBlocks: Block[] = [
      { id: 'dup_0', text: 'I' },
      { id: 'dup_1', text: 'know' },
      { id: 'dup_2', text: 'that' },
      { id: 'dup_3', text: 'that' },
      { id: 'dup_4', text: 'works.' },
    ];
    const acceptableOrders = [['I', 'know', 'that', 'that', 'works.']];

    for (let i = 0; i < 10000; i++) {
      const shuffled = strictShuffleBlocks(
        duplicateWordBlocks,
        acceptableOrders
      );
      const textOrder = shuffled.map((b) => b.text);
      expect(isAcceptableWordOrder(textOrder, acceptableOrders)).toBe(false);

      // 重複する 'that' の2つの異なるブロックIDが両方とも欠損なく保持されていること
      const ids = shuffled.map((b) => b.id).sort();
      expect(ids).toEqual(['dup_0', 'dup_1', 'dup_2', 'dup_3', 'dup_4']);
    }

    // 1要素以下およびフォールバックスワップ分岐の検証
    expect(strictShuffleBlocks([{ id: 'only1', text: 'Hi' }], [['Hi']])).toEqual([
      { id: 'only1', text: 'Hi' },
    ]);
    const threeBlocks: Block[] = [
      { id: '1', text: 'A' },
      { id: '2', text: 'B' },
      { id: '3', text: 'C' },
    ];
    // 6通りのうち5通りが正解でも残り1通りの非正解並びを確実に見つけること
    const fiveAcceptable = [
      ['A', 'B', 'C'],
      ['A', 'C', 'B'],
      ['B', 'A', 'C'],
      ['B', 'C', 'A'],
      ['C', 'A', 'B'],
    ];
    const nonMatching = strictShuffleBlocks(threeBlocks, fiveAcceptable);
    expect(nonMatching.map((b) => b.text)).toEqual(['C', 'B', 'A']);
  });
});
