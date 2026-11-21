// Cloudflare Workers + D1 同期・認証・Gemini APIプロキシ通信クライアント

import type {
  AiReport,
  Attempt,
  Chunk,
  CoachMessage,
  ReviewState,
  Session,
  Settings,
} from '../types';

const PASSCODE_STORAGE_KEY = 'rewire_app_passcode';

export interface CloudAuthStatus {
  cloudAvailable: boolean;
  passcodeRequired: boolean;
  serverHasGeminiKey: boolean;
}

export interface CloudSyncStores {
  chunks?: Chunk[];
  reviewStates?: ReviewState[];
  attempts?: Attempt[];
  sessions?: Session[];
  aiReports?: AiReport[];
  settings?: Settings;
  coachMessages?: CoachMessage[];
}

export function getSavedPasscode(): string {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    return window.localStorage.getItem(PASSCODE_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function savePasscode(passcode: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PASSCODE_STORAGE_KEY, passcode.trim());
    }
  } catch {
    // 無視
  }
}

export function clearPasscode(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(PASSCODE_STORAGE_KEY);
    }
  } catch {
    // 無視
  }
}

let cachedCloudStatus: CloudAuthStatus = {
  cloudAvailable: false,
  passcodeRequired: false,
  serverHasGeminiKey: false,
};

export function getCachedCloudStatus(): CloudAuthStatus {
  return cachedCloudStatus;
}

/**
 * サーバー（Cloudflare Worker）が利用可能か・パスコードが必要か確認する
 */
export async function checkCloudAuthStatus(): Promise<CloudAuthStatus> {
  if (typeof fetch === 'undefined' || typeof window === 'undefined') {
    return cachedCloudStatus;
  }
  try {
    const res = await fetch('/api/auth/status', {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) {
      cachedCloudStatus = {
        cloudAvailable: false,
        passcodeRequired: false,
        serverHasGeminiKey: false,
      };
      return cachedCloudStatus;
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      cachedCloudStatus = {
        cloudAvailable: false,
        passcodeRequired: false,
        serverHasGeminiKey: false,
      };
      return cachedCloudStatus;
    }
    const data = (await res.json()) as Partial<CloudAuthStatus>;
    cachedCloudStatus = {
      cloudAvailable: Boolean(data.cloudAvailable),
      passcodeRequired: Boolean(data.passcodeRequired),
      serverHasGeminiKey: Boolean(data.serverHasGeminiKey),
    };
    return cachedCloudStatus;
  } catch {
    cachedCloudStatus = {
      cloudAvailable: false,
      passcodeRequired: false,
      serverHasGeminiKey: false,
    };
    return cachedCloudStatus;
  }
}

/**
 * パスコードをサーバーで検証する
 */
export async function verifyCloudPasscode(passcode: string): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: passcode.trim() }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    if (data.ok) {
      savePasscode(passcode);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Cloudflare D1 から全ストアデータを取得する
 */
export async function fetchCloudStores(): Promise<{
  ok: boolean;
  unauthorized?: boolean;
  stores?: CloudSyncStores;
}> {
  try {
    const passcode = getSavedPasscode();
    const res = await fetch('/api/sync', {
      method: 'GET',
      headers: passcode ? { 'X-App-Passcode': passcode } : {},
      cache: 'no-store',
    });
    if (res.status === 401) {
      return { ok: false, unauthorized: true };
    }
    if (!res.ok) {
      return { ok: false };
    }
    const data = (await res.json()) as { stores?: CloudSyncStores };
    return { ok: true, stores: data.stores ?? {} };
  } catch {
    return { ok: false };
  }
}

/**
 * Cloudflare D1 へストアデータを保存（同期）する
 */
export async function pushCloudStores(stores: CloudSyncStores): Promise<boolean> {
  if (!cachedCloudStatus.cloudAvailable) {
    return false;
  }
  try {
    const passcode = getSavedPasscode();
    const res = await fetch('/api/sync', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(passcode ? { 'X-App-Passcode': passcode } : {}),
      },
      body: JSON.stringify({ stores }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * サーバー側プロキシ（/api/gemini）経由で Gemini API を呼び出す
 */
export async function fetchGeminiViaCloudProxy(params: {
  model: string;
  systemInstruction: string;
  userPrompt: string;
  temperature: number;
  responseSchema: Record<string, unknown>;
}): Promise<Response> {
  const passcode = getSavedPasscode();
  return fetch('/api/gemini', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(passcode ? { 'X-App-Passcode': passcode } : {}),
    },
    body: JSON.stringify(params),
  });
}
