// 使用者プロファイル（M / Y）管理と2週間無アクセス時の自動ログアウト制御

import { clearPasscode } from './cloudSyncService';

export type UserProfileId = 'M' | 'Y';

export const PROFILE_STORAGE_KEY = 'rewire_active_profile';
export const PROFILE_LAST_ACTIVE_KEY = 'rewire_profile_last_active_at';
export const INACTIVITY_LOGOUT_MS = 14 * 24 * 60 * 60 * 1000; // 2週間（14日間）

export function isValidProfileId(value: unknown): value is UserProfileId {
  return value === 'M' || value === 'Y';
}

export function clearActiveProfile(): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    window.localStorage.removeItem(PROFILE_LAST_ACTIVE_KEY);
  } catch {
    // 無視
  }
}

export function touchProfileActivity(nowMs: number = Date.now()): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const current = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (isValidProfileId(current)) {
      window.localStorage.setItem(PROFILE_LAST_ACTIVE_KEY, String(nowMs));
    }
  } catch {
    // 無視
  }
}

export function selectActiveProfile(
  profile: UserProfileId,
  nowMs: number = Date.now()
): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(PROFILE_STORAGE_KEY, profile);
    window.localStorage.setItem(PROFILE_LAST_ACTIVE_KEY, String(nowMs));
  } catch {
    // 無視
  }
}

/**
 * 現在の有効なプロファイルを取得する。
 * 最終アクセスから2週間（14日間）以上経過している場合は自動ログアウト（プロファイル＆パスコード削除）して null を返す。
 */
export function getActiveProfile(
  nowMs: number = Date.now()
): UserProfileId | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const rawProfile = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!isValidProfileId(rawProfile)) {
      return null;
    }

    const rawLastActive = window.localStorage.getItem(PROFILE_LAST_ACTIVE_KEY);
    const lastActiveMs = rawLastActive ? Number(rawLastActive) : NaN;

    if (
      Number.isFinite(lastActiveMs) &&
      nowMs - lastActiveMs >= INACTIVITY_LOGOUT_MS
    ) {
      clearActiveProfile();
      clearPasscode();
      return null;
    }

    // 有効なアクセスとして最終アクセス時刻を更新
    window.localStorage.setItem(PROFILE_LAST_ACTIVE_KEY, String(nowMs));
    return rawProfile;
  } catch {
    return null;
  }
}
