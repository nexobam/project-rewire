// JSONバックアップ促進バナー（週1回・昇格時表示、14日経過で閉じられない仕様・要件6-8）

import React, { useState } from 'react';
import { Download, Shield, XCircle } from 'lucide-react';
import type { ThemePalette } from '../domain/contrast';

export interface BackupBannerProps {
  lastBackupAt?: number;
  firstUsedAt?: number;
  justPromoted: boolean;
  palette: ThemePalette;
  onOneTapBackup: () => void;
  onDismissPromoted?: () => void;
  nowMs?: number;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export const BackupBanner: React.FC<BackupBannerProps> = ({
  lastBackupAt,
  firstUsedAt,
  justPromoted,
  palette,
  onOneTapBackup,
  onDismissPromoted,
  nowMs = Date.now(),
}) => {
  const [dismissed, setDismissed] = useState(false);

  const baseTimestamp =
    typeof lastBackupAt === 'number'
      ? lastBackupAt
      : typeof firstUsedAt === 'number'
        ? firstUsedAt
        : undefined;
  const elapsedMs =
    typeof baseTimestamp === 'number' ? Math.max(0, nowMs - baseTimestamp) : 0;
  const isOver14Days = elapsedMs >= FOURTEEN_DAYS_MS;
  const isOver7Days = elapsedMs >= SEVEN_DAYS_MS;

  const shouldShow = isOver14Days || justPromoted || (!dismissed && isOver7Days);

  if (!shouldShow) {
    return null;
  }

  return (
    <div
      style={{
        backgroundColor: palette.card,
        borderColor: palette.border,
        color: palette.text,
      }}
      className="border rounded-lg p-3 mb-4 flex flex-wrap items-center justify-between gap-3"
      data-testid="backup-banner"
    >
      <div className="flex items-center gap-2.5">
        <Shield size={20} strokeWidth={1.75} color="currentColor" />
        <div className="text-sm">
          <p className="font-semibold">
            {justPromoted
              ? 'レベル昇格おめでとうございます！現在の学習記録をバックアップしましょう。'
              : isOver14Days
                ? '前回のバックアップから14日以上経過しています（保護のためバックアップ完了までこのバナーは閉じられません）。'
                : '週1回の定期データ保護：1タップでJSONバックアップを保存できます。'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOneTapBackup}
          style={{
            backgroundColor: palette.amberSurface ?? palette.text,
            color: palette.amberSurfaceText ?? palette.card,
            borderColor: palette.border,
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded font-semibold text-xs tactile-btn"
        >
          <Download size={15} strokeWidth={1.75} color="currentColor" />
          <span>1タップでJSONバックアップ</span>
        </button>

        {/* 14日を過ぎたらバナーを閉じられないようにする（アプリ自体は使えるまま・要件6-8） */}
        {!isOver14Days && (
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              onDismissPromoted?.();
            }}
            className="p-1 rounded opacity-75 hover:opacity-100"
            aria-label="バナーを閉じる"
            data-testid="dismiss-backup-banner"
          >
            <XCircle size={18} strokeWidth={1.75} color="currentColor" />
          </button>
        )}
      </div>
    </div>
  );
};
