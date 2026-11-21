// 学習日（午前4時区切り・ローカルタイム基準）および連続記録・お休みチケット計算ロジック

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/**
 * ローカル時刻から4時間引いた YYYY-MM-DD を返す（UTCは使わない）
 */
export function getStudyDate(now: Date | number = new Date()): string {
  const timestamp = typeof now === 'number' ? now : now.getTime();
  const shifted = new Date(timestamp - FOUR_HOURS_MS);
  const year = shifted.getFullYear();
  const month = String(shifted.getMonth() + 1).padStart(2, '0');
  const day = String(shifted.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * YYYY-MM-DD 文字列をローカル日付オブジェクト（正午基準でDSTずれ防止）に変換
 */
export function parseStudyDate(studyDate: string): Date {
  const [y, m, d] = studyDate.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/**
 * 基準の学習日に日数を加算した YYYY-MM-DD を返す
 */
export function addDaysToStudyDate(studyDate: string, days: number): string {
  const dt = parseStudyDate(studyDate);
  dt.setDate(dt.getDate() + days);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 2つの学習日 (toDate - fromDate) の日数差を返す
 */
export function diffStudyDatesInDays(fromDate: string, toDate: string): number {
  const d1 = parseStudyDate(fromDate);
  const d2 = parseStudyDate(toDate);
  return Math.round((d2.getTime() - d1.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * 指定した学習日が属する週の月曜日の学習日 (YYYY-MM-DD) を返す
 * （毎週月曜の午前4時にチケットを最大2枚まで補充するための週識別子）
 */
export function getMondayOfStudyWeek(studyDate: string): string {
  const dt = parseStudyDate(studyDate);
  const dayOfWeek = dt.getDay(); // 0: 日, 1: 月, ...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return addDaysToStudyDate(studyDate, diffToMonday);
}

export interface StreakTicketEvaluation {
  streakDays: number;
  restTickets: number;
  lastTicketRefillWeek: string;
  lastEvaluatedStudyDate: string;
  suggestRehab: boolean;
}

/**
 * 学習履歴のある学習日リストと現在のチケット状態から、
 * 毎週月曜午前4時の補充（最大2枚）、未学習日の自動チケット消費、連続記録、
 * および2日以上空いた場合の「3分リハビリメニュー」提案有無を計算する
 */
export function evaluateStreakAndTickets(params: {
  currentStudyDate: string;
  activeStudyDates: string[];
  currentTickets: number;
  lastTicketRefillWeek?: string;
  lastEvaluatedStudyDate?: string;
}): StreakTicketEvaluation {
  const {
    currentStudyDate,
    activeStudyDates,
    currentTickets,
    lastTicketRefillWeek,
    lastEvaluatedStudyDate,
  } = params;

  const activeSet = new Set(activeStudyDates);
  const sortedDates = [...activeSet].sort();

  // リハビリ提案判定：最後の学習日から2日以上空いているか（今日まだ学習していない場合）
  let suggestRehab = false;
  const pastDates = sortedDates.filter((d) => d < currentStudyDate);
  if (pastDates.length > 0 && !activeSet.has(currentStudyDate)) {
    const lastActive = pastDates[pastDates.length - 1];
    if (diffStudyDatesInDays(lastActive, currentStudyDate) >= 2) {
      suggestRehab = true;
    }
  }

  // チケット補充・消費シミュレーション
  let tickets = Math.min(2, Math.max(0, currentTickets));
  const currentWeekMonday = getMondayOfStudyWeek(currentStudyDate);
  let refillWeek = lastTicketRefillWeek ?? currentWeekMonday;

  // 週が変わっていれば（月曜午前4時以降）、最大2枚まで補充
  if (currentWeekMonday > refillWeek) {
    tickets = 2;
    refillWeek = currentWeekMonday;
  }

  // 前回評価日から前日までの未学習日についてチケットを自動消費
  if (lastEvaluatedStudyDate && lastEvaluatedStudyDate < currentStudyDate) {
    let cursor = lastEvaluatedStudyDate;
    while (cursor < currentStudyDate) {
      const cursorWeek = getMondayOfStudyWeek(cursor);
      if (cursorWeek > refillWeek) {
        tickets = 2;
        refillWeek = cursorWeek;
      }
      // 前日以前で学習がなかった日にチケットを1枚使う
      if (!activeSet.has(cursor) && sortedDates.some((d) => d < cursor)) {
        if (tickets > 0) {
          tickets -= 1;
        }
      }
      cursor = addDaysToStudyDate(cursor, 1);
    }
  }

  // 現在の連続記録（ストリーク）の計算
  // 今日学習済みなら今日から、未学習なら昨日から遡り、各週（月曜〜日曜）最大2枚のチケット範囲で未学習日を繋ぐ
  // （順方向で消費済みの restTickets と二重引きしないよう週単位2枚枠で独立計算する）
  let streakDays = 0;
  if (sortedDates.length > 0) {
    const firstEverDate = sortedDates[0];
    let checkDate = activeSet.has(currentStudyDate)
      ? currentStudyDate
      : addDaysToStudyDate(currentStudyDate, -1);
    let simulatedTicketsForWeek = 2;
    let currentTrackWeek = getMondayOfStudyWeek(checkDate);

    while (checkDate >= firstEverDate) {
      const weekOfCheck = getMondayOfStudyWeek(checkDate);
      if (weekOfCheck < currentTrackWeek) {
        simulatedTicketsForWeek = 2;
        currentTrackWeek = weekOfCheck;
      }
      if (activeSet.has(checkDate)) {
        streakDays += 1;
      } else if (simulatedTicketsForWeek > 0) {
        simulatedTicketsForWeek -= 1;
      } else {
        break;
      }
      checkDate = addDaysToStudyDate(checkDate, -1);
    }
  }

  return {
    streakDays,
    restTickets: tickets,
    lastTicketRefillWeek: refillWeek,
    lastEvaluatedStudyDate: currentStudyDate,
    suggestRehab,
  };
}
