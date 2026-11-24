// ヒートマップカレンダー（緑1色の濃淡で日別合計学習時間を表示＋日付タップでモード別内訳＆AIレポート表示・要件7）

import React, { useState } from 'react';
import { Calendar, CheckCircle, Clock, FileText } from 'lucide-react';
import type { ThemePalette } from '../domain/contrast';
import { addDaysToStudyDate, getStudyDate } from '../domain/studyDate';
import type { AiReport, Session, SessionMode } from '../types';

export interface HeatmapCalendarProps {
  sessions: Session[];
  aiReports: AiReport[];
  palette: ThemePalette;
  currentStudyDate?: string;
}

const MODE_LABELS: Record<SessionMode, string> = {
  silent: 'サイレント',
  speak: '発話ドリル',
  live: 'Live実戦',
  sleep: 'スリープ',
  boss: 'ボス戦',
  diagnosis: 'Lv.0診断',
  rehab: '3分リハビリ',
};

export const HeatmapCalendar: React.FC<HeatmapCalendarProps> = ({
  sessions,
  aiReports,
  palette,
  currentStudyDate = getStudyDate(),
}) => {
  const [selectedDate, setSelectedDate] = useState<string>(currentStudyDate);

  // 直近28日間の学習日配列を生成
  const days: string[] = [];
  for (let i = 27; i >= 0; i--) {
    days.push(addDaysToStudyDate(currentStudyDate, -i));
  }

  // 日付ごとの合計秒数とモード別内訳を集計
  const minutesByDate = new Map<string, number>();
  const modeMinutesByDate = new Map<string, Partial<Record<SessionMode, number>>>();

  for (const s of sessions) {
    const mins = Math.max(0, Math.round(s.activeSeconds / 60));
    if (mins <= 0 && s.activeSeconds <= 0) continue;
    const effectiveMins = Math.max(1, mins);
    minutesByDate.set(
      s.studyDate,
      (minutesByDate.get(s.studyDate) ?? 0) + effectiveMins
    );

    const byMode = modeMinutesByDate.get(s.studyDate) ?? {};
    byMode[s.mode] = (byMode[s.mode] ?? 0) + effectiveMins;
    modeMinutesByDate.set(s.studyDate, byMode);
  }

  // 緑1色の濃淡（透明度）を計算（要件7）
  const getGreenOpacity = (minutes: number): number => {
    if (minutes <= 0) return 0;
    if (minutes < 10) return 0.28;
    if (minutes < 25) return 0.52;
    if (minutes < 45) return 0.76;
    return 1.0;
  };

  const selectedTotalMinutes = minutesByDate.get(selectedDate) ?? 0;
  const selectedModes = modeMinutesByDate.get(selectedDate) ?? {};
  const selectedSessionIds = new Set(
    sessions.filter((s) => s.studyDate === selectedDate).map((s) => s.id)
  );
  const selectedReports = aiReports.filter(
    (r) => r.studyDate === selectedDate || selectedSessionIds.has(r.sessionId)
  );

  const greenHex = palette.greenText ?? '#15803D';

  return (
    <div
      style={{
        backgroundColor: palette.card,
        borderColor: palette.border,
        color: palette.text,
      }}
      className="border rounded-lg p-5 space-y-4"
      data-testid="heatmap-calendar"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-base">
          <Calendar size={18} strokeWidth={1.75} color="currentColor" />
          <span>学習ヒートマップ（直近28日間）</span>
        </div>
        <span className="text-xs opacity-75">日付タップで内訳・AIレポート表示</span>
      </div>

      {/* 7列×4週のヒートマップグリッド（緑1色の濃淡のみ） */}
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {days.map((dateStr) => {
          const mins = minutesByDate.get(dateStr) ?? 0;
          const opacity = getGreenOpacity(mins);
          const isSelected = dateStr === selectedDate;
          const shortLabel = dateStr.slice(5); // MM-DD

          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => setSelectedDate(dateStr)}
              style={{
                borderColor: isSelected ? palette.text : palette.border,
                backgroundColor: palette.background,
              }}
              className={`relative rounded border p-1 sm:p-2 text-center transition-all ${
                isSelected ? 'ring-1 ring-current font-bold' : ''
              }`}
              data-testid={`heatmap-cell-${dateStr}`}
            >
              {/* 緑1色の濃淡オーバーレイ */}
              {opacity > 0 && (
                <div
                  aria-hidden="true"
                  style={{
                    backgroundColor: greenHex,
                    opacity: opacity * 0.25,
                  }}
                  className="absolute inset-0 rounded pointer-events-none"
                />
              )}
              <div className="relative z-10 text-[11px] leading-tight">
                <div>{shortLabel}</div>
                <div className="font-mono text-[10px] opacity-80">
                  {mins > 0 ? `${mins}m` : '0m'}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* 選択した日付の詳細（モード別内訳＆AIレポート） */}
      <div
        style={{
          backgroundColor: palette.background,
          borderColor: palette.border,
        }}
        className="border rounded-lg p-4 space-y-3 text-xs"
        data-testid="heatmap-day-detail"
      >
        <div className="flex items-center justify-between font-bold text-sm">
          <span>{selectedDate} の学習ログ</span>
          <span className="flex items-center gap-1">
            <Clock size={14} strokeWidth={1.75} color="currentColor" />
            合計 {selectedTotalMinutes} 分
          </span>
        </div>

        {/* モード別内訳 */}
        {Object.keys(selectedModes).length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {(Object.entries(selectedModes) as [SessionMode, number][]).map(
              ([mode, mins]) => (
                <span
                  key={mode}
                  style={{
                    backgroundColor: palette.card,
                    borderColor: palette.border,
                  }}
                  className="px-2.5 py-1 rounded border font-semibold"
                >
                  {MODE_LABELS[mode] ?? mode}: {mins}分
                </span>
              )
            )}
          </div>
        ) : (
          <p className="opacity-70">この日の学習記録はありません。</p>
        )}

        {/* AIレポート＆Live総評履歴 */}
        {selectedReports.length > 0 && (
          <div className="space-y-2 pt-2 border-t" style={{ borderColor: palette.border }}>
            <div className="flex items-center gap-1.5 font-bold">
              <FileText size={14} strokeWidth={1.75} color="currentColor" />
              <span>AI講師レポート・Live総評 ({selectedReports.length}件)</span>
            </div>
            {selectedReports.map((rep) => (
              <div
                key={rep.id}
                style={{
                  backgroundColor: palette.card,
                  borderColor: palette.border,
                }}
                className="p-3 rounded border space-y-1.5"
              >
                {rep.status === 'pending' && !rep.analyst && !rep.liveLog && (
                  <p className="text-xs opacity-75">
                    AI講師チームが分析レポートを作成中です...
                  </p>
                )}
                {rep.status === 'failed' && !rep.analyst && !rep.liveLog && (
                  <p className="text-xs opacity-75">
                    通信状況などによりレポート作成を完了できませんでした。
                  </p>
                )}
                {rep.analyst && (
                  <div>
                    <p className="font-semibold">
                      【データアナリスト】 {rep.analyst.bottleneck}
                    </p>
                    <p className="opacity-85">{rep.analyst.growth}</p>
                  </div>
                )}
                {rep.teacher &&
                  rep.teacher.map((t, idx) => (
                    <div key={idx} className="pt-1">
                      <p className="font-semibold">
                        【コアイメージ先生】 {t.coreImage}
                      </p>
                      <p className="opacity-85">発音: {t.pronunciation}</p>
                      <p className="opacity-85 flex items-center gap-1">
                        <CheckCircle size={12} strokeWidth={1.75} color="currentColor" />
                        <span>{t.praise}</span>
                      </p>
                    </div>
                  ))}
                {rep.liveLog && (
                  <div className="pt-1 space-y-1">
                    <p className="font-semibold">
                      【Live実戦総評（Fluency: {rep.liveLog.fluencyScore}/5）】{' '}
                      {rep.liveLog.overallReview}
                    </p>
                    {rep.liveLog.topicsDiscussed &&
                      rep.liveLog.topicsDiscussed.length > 0 && (
                        <p>
                          話したトピック:{' '}
                          {rep.liveLog.topicsDiscussed.join(' / ')}
                        </p>
                      )}
                    {rep.liveLog.conversationHighlights && (
                      <p>会話内容: {rep.liveLog.conversationHighlights}</p>
                    )}
                    {rep.liveLog.goodPoints.length > 0 && (
                      <p>良かった点: {rep.liveLog.goodPoints.join(' / ')}</p>
                    )}
                    {rep.liveLog.badPoints.length > 0 && (
                      <p>改善点: {rep.liveLog.badPoints.join(' / ')}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
