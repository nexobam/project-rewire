// タイミング判定の境界値・リプレイ上限・perTapMs中央値テスト

import { describe, expect, it } from 'vitest';
import {
  applyReplayCap,
  calculateCompletionBudget,
  calculateMedianPerTapMs,
  clampPerTapMs,
  isAcceptableWordOrder,
  judgePictureChoiceTiming,
  judgeWordOrderTiming,
} from '../domain/timingJudge';

describe('timingJudge - 動的タイムリミットと境界値判定', () => {
  it('perTapMs のクランプと中央値算出が 350〜700ms の範囲に収まること', () => {
    expect(clampPerTapMs(200)).toBe(350);
    expect(clampPerTapMs(500)).toBe(500);
    expect(clampPerTapMs(950)).toBe(700);
    expect(clampPerTapMs(NaN)).toBe(500);

    expect(calculateMedianPerTapMs([])).toBe(500);
    expect(calculateMedianPerTapMs([400, 500, 600])).toBe(500);
    expect(calculateMedianPerTapMs([400, 500, 600, 700])).toBe(550);
    expect(calculateMedianPerTapMs([100, 200, 250])).toBe(350);
  });

  it('語順ブロック判定の境界値（緑・黄・赤）が正確であること', () => {
    // perTapMs = 500, blockCount = 5 -> completionBudget = 500 * 5 + 800 = 3300ms
    const perTapMs = 500;
    const blockCount = 5;
    expect(calculateCompletionBudget(perTapMs, blockCount)).toBe(3300);

    // 緑の境界上限（reactionMs = 1200, completionMs = 3300）
    const greenExact = judgeWordOrderTiming({
      isCorrect: true,
      reactionMs: 1200,
      completionMs: 3300,
      blockCount,
      perTapMs,
    });
    expect(greenExact.rating).toBe('green');
    expect(greenExact.missType).toBeUndefined();

    // 初動が 1201ms になると黄に落ちる
    const yellowByReaction = judgeWordOrderTiming({
      isCorrect: true,
      reactionMs: 1201,
      completionMs: 3300,
      blockCount,
      perTapMs,
    });
    expect(yellowByReaction.rating).toBe('yellow');

    // 完了が 3301ms になると黄に落ちる
    const yellowByCompletion = judgeWordOrderTiming({
      isCorrect: true,
      reactionMs: 1200,
      completionMs: 3301,
      blockCount,
      perTapMs,
    });
    expect(yellowByCompletion.rating).toBe('yellow');

    // 黄の境界上限（reactionMs = 2000, completionMs = 3300 + 1500 = 4800）
    const yellowExact = judgeWordOrderTiming({
      isCorrect: true,
      reactionMs: 2000,
      completionMs: 4800,
      blockCount,
      perTapMs,
    });
    expect(yellowExact.rating).toBe('yellow');

    // 初動 2001ms または完了 4801ms で赤に落ちる
    expect(
      judgeWordOrderTiming({
        isCorrect: true,
        reactionMs: 2001,
        completionMs: 4800,
        blockCount,
        perTapMs,
      }).rating
    ).toBe('red');

    expect(
      judgeWordOrderTiming({
        isCorrect: true,
        reactionMs: 2000,
        completionMs: 4801,
        blockCount,
        perTapMs,
      }).rating
    ).toBe('red');

    // 不正解なら時間内でも赤
    const wrong = judgeWordOrderTiming({
      isCorrect: false,
      reactionMs: 500,
      completionMs: 1500,
      blockCount,
      perTapMs,
    });
    expect(wrong.rating).toBe('red');
    expect(wrong.missType).toBe('order_delay');
  });

  it('絵カード4択（3200/5500ms）および音変化4択（4000/6500ms）の人間工学的境界値が正確であること', () => {
    // 絵カード4択
    expect(
      judgePictureChoiceTiming({ isCorrect: true, completionMs: 3200 }).rating
    ).toBe('green');
    expect(
      judgePictureChoiceTiming({ isCorrect: true, completionMs: 3201 }).rating
    ).toBe('yellow');
    expect(
      judgePictureChoiceTiming({ isCorrect: true, completionMs: 5500 }).rating
    ).toBe('yellow');
    expect(
      judgePictureChoiceTiming({ isCorrect: true, completionMs: 5501 }).rating
    ).toBe('red');

    // 音変化・連続多聴（英文4択）
    expect(
      judgePictureChoiceTiming({
        isCorrect: true,
        completionMs: 4000,
        isSoundChange: true,
      }).rating
    ).toBe('green');
    expect(
      judgePictureChoiceTiming({
        isCorrect: true,
        completionMs: 4001,
        isSoundChange: true,
      }).rating
    ).toBe('yellow');
    expect(
      judgePictureChoiceTiming({
        isCorrect: true,
        completionMs: 6500,
        isSoundChange: true,
      }).rating
    ).toBe('yellow');
    expect(
      judgePictureChoiceTiming({
        isCorrect: true,
        completionMs: 6501,
        isSoundChange: true,
      }).rating
    ).toBe('red');
    expect(
      judgePictureChoiceTiming({
        isCorrect: false,
        completionMs: 800,
        isSoundChange: true,
      })
    ).toEqual({
      rating: 'red',
      missType: 'sound_change',
    });
  });

  it('轟音リプレイ救済：表示前1回はペナルティなし、表示後リプレイまたは表示前2回以上は最高評価が黄になること', () => {
    expect(applyReplayCap('green', 0, 0)).toBe('green');
    expect(applyReplayCap('green', 1, 0)).toBe('green');
    expect(applyReplayCap('green', 2, 0)).toBe('yellow');
    expect(applyReplayCap('green', 0, 1)).toBe('yellow');
    expect(applyReplayCap('red', 0, 1)).toBe('red');

    const cappedWordOrder = judgeWordOrderTiming({
      isCorrect: true,
      reactionMs: 800,
      completionMs: 2000,
      blockCount: 5,
      perTapMs: 500,
      replayBeforeShown: 1,
      replayAfterShown: 1,
    });
    expect(cappedWordOrder.rating).toBe('yellow');
  });

  it('acceptableOrders の複数正解パターンを正しく判定できること', () => {
    const orders = [
      ['I', 'will', 'call', 'you', 'tomorrow.'],
      ['Tomorrow,', 'I', 'will', 'call', 'you.'],
    ];
    expect(
      isAcceptableWordOrder(['I', 'will', 'call', 'you', 'tomorrow.'], orders)
    ).toBe(true);
    expect(
      isAcceptableWordOrder(['Tomorrow,', 'I', 'will', 'call', 'you.'], orders)
    ).toBe(true);
    expect(
      isAcceptableWordOrder(['I', 'call', 'will', 'you', 'tomorrow.'], orders)
    ).toBe(false);
    expect(isAcceptableWordOrder([], orders)).toBe(false);
  });
});
