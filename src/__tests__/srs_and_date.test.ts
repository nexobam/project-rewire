// SRSの段階遷移・卒業・90日後抜き打ち・午前4時日付境界・お休みチケットテスト

import { describe, expect, it } from 'vitest';
import {
  createInitialReviewState,
  isReviewDue,
  updateReviewState,
} from '../domain/srs';
import {
  addDaysToStudyDate,
  diffStudyDatesInDays,
  evaluateStreakAndTickets,
  getMondayOfStudyWeek,
  getStudyDate,
} from '../domain/studyDate';

describe('srs & studyDate - 間隔反復と午前4時日付境界', () => {
  it('午前4時の日付境界（03:59は前日、04:00は当日）をローカル時刻で正しく判定すること', () => {
    const before4am = new Date(2026, 10, 21, 3, 59, 59); // 2026-11-21 03:59:59
    const at4am = new Date(2026, 10, 21, 4, 0, 0); // 2026-11-21 04:00:00

    expect(getStudyDate(before4am)).toBe('2026-11-20');
    expect(getStudyDate(at4am)).toBe('2026-11-21');
    expect(diffStudyDatesInDays('2026-11-20', '2026-11-21')).toBe(1);
  });

  it('SRSが [1, 3, 7, 14, 30] 日の段階で進み、30日段階(stage 4)の緑で卒業＆90日後抜き打ちになり、赤で段階0に戻り卒業も取り消されること', () => {
    const baseDate = '2026-11-20';
    let state = createInitialReviewState('lv1_01', baseDate);
    expect(state.stage).toBe(0);
    expect(isReviewDue(state, baseDate)).toBe(true);

    // stage 0 -> green -> stage 1 (3日後)
    state = updateReviewState(state, 'green', baseDate, 'word_order');
    expect(state.stage).toBe(1);
    expect(state.dueDate).toBe(addDaysToStudyDate(baseDate, 3));

    // stage 1 -> yellow -> 同じ段階のまま3日後で再スケジュール
    const yellowDate = '2026-11-23';
    state = updateReviewState(state, 'yellow', yellowDate, 'word_order');
    expect(state.stage).toBe(1);
    expect(state.dueDate).toBe(addDaysToStudyDate(yellowDate, 3));

    // stage 1 -> 2 (7日後) -> 3 (14日後) -> 4 (30日後)
    state = updateReviewState(state, 'green', '2026-11-26', 'word_order');
    expect(state.stage).toBe(2);
    expect(state.dueDate).toBe(addDaysToStudyDate('2026-11-26', 7));

    state = updateReviewState(state, 'green', '2026-12-03', 'word_order');
    expect(state.stage).toBe(3);
    expect(state.dueDate).toBe(addDaysToStudyDate('2026-12-03', 14));

    state = updateReviewState(state, 'green', '2026-12-17', 'word_order');
    expect(state.stage).toBe(4);
    expect(state.graduated).toBe(false);
    expect(state.dueDate).toBe(addDaysToStudyDate('2026-12-17', 30));

    // stage 4 で緑 -> 卒業（graduated: true）し、90日後に抜き打ち
    const gradDate = '2027-01-16';
    state = updateReviewState(state, 'green', gradDate, 'word_order');
    expect(state.graduated).toBe(true);
    expect(state.spotCheckDate).toBe(addDaysToStudyDate(gradDate, 90));
    expect(isReviewDue(state, addDaysToStudyDate(gradDate, 89))).toBe(false);
    expect(isReviewDue(state, addDaysToStudyDate(gradDate, 90))).toBe(true);

    // 卒業後でも赤をとったら段階0（1日後）に戻し、卒業を取り消す
    const spotDate = addDaysToStudyDate(gradDate, 90);
    state = updateReviewState(state, 'red', spotDate, 'word_order');
    expect(state.stage).toBe(0);
    expect(state.graduated).toBe(false);
    expect(state.spotCheckDate).toBeUndefined();
    expect(state.dueDate).toBe(addDaysToStudyDate(spotDate, 1));
  });

  it('お休みチケットの月曜午前4時補充（最大2枚）・未学習日の自動消費・2日以上空白でのリハビリ提案が正しく動くこと', () => {
    expect(getMondayOfStudyWeek('2026-11-20')).toBe('2026-11-16'); // 金曜 -> 月曜は11/16

    // 11/17に学習し、11/18は未学習、現在11/19（2日空いたのでリハビリ提案あり＆チケット1枚自動消費）
    const eval1 = evaluateStreakAndTickets({
      currentStudyDate: '2026-11-19',
      activeStudyDates: ['2026-11-17'],
      currentTickets: 2,
      lastTicketRefillWeek: '2026-11-16',
      lastEvaluatedStudyDate: '2026-11-18',
    });
    expect(eval1.restTickets).toBe(1);
    expect(eval1.streakDays).toBe(1);
    expect(eval1.suggestRehab).toBe(true);

    // 翌週月曜（2026-11-23）になるとチケットが最大2枚に補充される
    const evalNextWeek = evaluateStreakAndTickets({
      currentStudyDate: '2026-11-23',
      activeStudyDates: ['2026-11-22', '2026-11-23'],
      currentTickets: 0,
      lastTicketRefillWeek: '2026-11-16',
      lastEvaluatedStudyDate: '2026-11-22',
    });
    expect(evalNextWeek.restTickets).toBe(2);
    expect(evalNextWeek.lastTicketRefillWeek).toBe('2026-11-23');
  });
});
