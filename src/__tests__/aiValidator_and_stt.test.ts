// AI出力の7項目機械検証・シードデータ整合性・STT一致率計算テスト

import { describe, expect, it } from 'vitest';
import { ALL_SEED_CHUNKS } from '../data/seed';
import {
  buildDuplicateForbidList,
  filterValidAiQuestions,
  validateAiQuestion,
} from '../domain/aiValidator';
import {
  getPictureSceneVisualMeta,
  selectDistinctPictureDistractors,
} from '../domain/pictureChoiceDistinct';
import {
  calculateSttMatch,
  containsNgWord,
  resolveSpeechRating,
} from '../domain/sttMatcher';
import { ICON_WHITELIST } from '../types';

describe('aiValidator & sttMatcher - AI生成問題の7項目機械検証と音声認識補助', () => {
  const baseValidRaw = {
    contentCategory: 'daily',
    sceneCategory: 'cafe',
    grammarPattern: 'let_me_v',
    enText: 'Let me grab a quick coffee.',
    blocks: ['Let', 'me', 'grab', 'a', 'quick', 'coffee.'],
    acceptableOrders: [['Let', 'me', 'grab', 'a', 'quick', 'coffee.']],
    icons: ['Coffee', 'Clock'],
    tags: ['カフェ', '店員', '焦り'],
    coreImageJa: '手元にコーヒーをサッと引き寄せる動き。',
    pronunciationTip: 'Let me はレミ、grab a はグラバと連結する。',
    hasSoundChange: true,
  };

  it('正常なAI出力が検証を通過すること', () => {
    const res = validateAiQuestion(baseValidRaw, [], 1);
    expect(res.valid).toBe(true);
  });

  it('要件5の7つの拒否条件のいずれかに該当する問題をすべて確実に捨てること', () => {
    // 1. zodスキーマ不一致
    const badZod = validateAiQuestion({ invalid: true }, []);
    expect(badZod.valid).toBe(false);
    if (!badZod.valid) expect(badZod.failure.reason).toBe('zod_invalid');

    // 2. アイコンがホワイトリスト外
    const badIcon = validateAiQuestion(
      { ...baseValidRaw, icons: ['NotAnIcon', 'Coffee'] },
      []
    );
    expect(badIcon.valid).toBe(false);
    if (!badIcon.valid)
      expect(badIcon.failure.reason).toBe('icon_not_whitelisted');

    // 3. タグが8文字を超える
    const badTag = validateAiQuestion(
      {
        ...baseValidRaw,
        tags: ['カフェ', '店員', '123456789'], // 9文字
      },
      []
    );
    expect(badTag.valid).toBe(false);
    if (!badTag.valid) expect(badTag.failure.reason).toBe('invalid_tags');

    // 4. enText が80文字を超える
    const longWords = [
      'This',
      'sentence',
      'is',
      'deliberately',
      'constructed',
      'with',
      'extraordinarily',
      'lengthy',
      'vocabulary.',
    ];
    const badLen = validateAiQuestion(
      {
        ...baseValidRaw,
        enText: longWords.join(' '),
        blocks: longWords,
        acceptableOrders: [longWords],
      },
      []
    );
    expect(badLen.valid).toBe(false);
    if (!badLen.valid) expect(badLen.failure.reason).toBe('en_text_too_long');

    // 5. ブロック数が3〜9個の範囲外（2個または10個）
    const twoWords = ['Get', 'coffee.'];
    const badBlocks2 = validateAiQuestion(
      {
        ...baseValidRaw,
        enText: 'Get coffee.',
        blocks: twoWords,
        acceptableOrders: [twoWords],
      },
      []
    );
    expect(badBlocks2.valid).toBe(false);
    if (!badBlocks2.valid)
      expect(badBlocks2.failure.reason).toBe('block_count_out_of_range');

    const tenWords = ['I', ' really', 'want', 'to', 'go', 'to', 'the', 'game', 'right', 'now.'];
    const badBlocks10 = validateAiQuestion(
      {
        ...baseValidRaw,
        enText: tenWords.join(' '),
        blocks: tenWords,
        acceptableOrders: [tenWords],
      },
      []
    );
    expect(badBlocks10.valid).toBe(false);
    if (!badBlocks10.valid)
      expect(badBlocks10.failure.reason).toBe('block_count_out_of_range');

    // 6. acceptableOrders に enText 自体の並びが含まれていない
    const badOrder = validateAiQuestion(
      {
        ...baseValidRaw,
        acceptableOrders: [['coffee.', 'Let', 'me', 'grab', 'a', 'quick']],
      },
      []
    );
    expect(badOrder.valid).toBe(false);
    if (!badOrder.valid)
      expect(badOrder.failure.reason).toBe(
        'missing_en_text_in_acceptable_orders'
      );

    // 7. 重複禁止リスト（直近20件の enText）と重なる
    const forbid = buildDuplicateForbidList(ALL_SEED_CHUNKS);
    expect(forbid.length).toBe(20);
    const badDup = validateAiQuestion(baseValidRaw, [
      'Let me grab a quick coffee.',
    ]);
    expect(badDup.valid).toBe(false);
    if (!badDup.valid) expect(badDup.failure.reason).toBe('duplicate_en_text');

    // filterValidAiQuestions が有効な問題のみを通し、バッチ内重複も排除すること
    const filtered = filterValidAiQuestions(
      [baseValidRaw, baseValidRaw, { invalid: true }],
      []
    );
    expect(filtered.length).toBe(1);
  });

  it('初期同梱シードデータ全60問（Lv.0:15問、Lv.1:30問、Lv.2〜4:各5問）がすべての制約を満たしていること', () => {
    expect(ALL_SEED_CHUNKS.length).toBe(60);
    const whitelist = new Set<string>(ICON_WHITELIST);

    for (const chunk of ALL_SEED_CHUNKS) {
      expect(chunk.enText.length).toBeLessThanOrEqual(80);
      expect(chunk.blocks.length).toBeGreaterThanOrEqual(3);
      expect(chunk.blocks.length).toBeLessThanOrEqual(9);
      expect(whitelist.has(chunk.visual.icons[0])).toBe(true);
      expect(whitelist.has(chunk.visual.icons[1])).toBe(true);
      expect(chunk.visual.tags.length).toBe(3);
      for (const tag of chunk.visual.tags) {
        expect([...tag].length).toBeLessThanOrEqual(8);
      }
      const selfWords = chunk.blocks.map((b) => b.text);
      expect(
        chunk.acceptableOrders.some(
          (o) =>
            o.length === selfWords.length &&
            o.every((w, i) => w === selfWords[i])
        )
      ).toBe(true);
    }
  });

  it('STT一致率が小文字化・句読点除去の単語単位で80%以上を一致と判定し、STTが不一致でも自己判定が優先されること', () => {
    const match80 = calculateSttMatch(
      'Let me get a cold brew.',
      'let me get a hot' // 6語中4語では66%、5語中4語なら80%
    );
    expect(match80.isMatched).toBe(false);

    const match5of6 = calculateSttMatch(
      'Let me get a cold brew.',
      'let me get a cold!'
    );
    expect(match5of6.matchRate).toBeCloseTo(5 / 6);
    expect(match5of6.isMatched).toBe(true);

    // STTが不一致（matchRate: 0.2）でも、ユーザーが緑と自己判定すれば緑になる（STTだけで赤にしない）
    const resolved = resolveSpeechRating({
      selfJudgedRating: 'green',
      sttMatchRate: 0.2,
    });
    expect(resolved.finalRating).toBe('green');
    expect(resolved.selfJudged).toBe(true);

    // Lv.3 NGワード検出
    expect(
      containsNgWord('We had to postpone the meeting.', ['postpone', 'delay'])
    ).toEqual(['postpone']);
  });

  it('絵カード4択（Lv.1日常会話全25問）で選ばれる4枚のカードがすべて異なる意味クラスタ・場所タグ・状況タグ・焦点タグを持ち、紛らわしい選択肢が並ばないこと', () => {
    const lv1Daily = ALL_SEED_CHUNKS.filter(
      (c) => c.level === 1 && c.contentCategory === 'daily'
    );
    expect(lv1Daily.length).toBe(25);

    for (const target of lv1Daily) {
      const distractors = selectDistinctPictureDistractors(
        target,
        ALL_SEED_CHUNKS,
        3
      );
      expect(distractors.length).toBe(3);

      const fourCards = [target, ...distractors];
      const clusters = new Set(
        fourCards.map((c) => getPictureSceneVisualMeta(c).cluster)
      );
      const places = new Set(fourCards.map((c) => c.visual.tags[0]));
      const situations = new Set(fourCards.map((c) => c.visual.tags[2]));
      const actions = new Set(
        fourCards.map((c) => getPictureSceneVisualMeta(c).actionTag)
      );

      // 4枚すべてで意味クラスタ・場所・状況・焦点が完全に別々であること
      expect(clusters.size).toBe(4);
      expect(places.size).toBe(4);
      expect(situations.size).toBe(4);
      expect(actions.size).toBe(4);
    }
  });
});
