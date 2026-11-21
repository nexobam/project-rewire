// IndexedDB データベース管理および1問ごとのアトミックトランザクション保存

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { ALL_SEED_CHUNKS } from '../data/seed';
import {
  DEFAULT_SETTINGS,
  type AiReport,
  type Attempt,
  type Chunk,
  type CoachMessage,
  type ReviewState,
  type Session,
  type Settings,
} from '../types';

export const DB_NAME = 'project-rewire-db';
export const DB_VERSION = 1;

interface RewireDBSchema extends DBSchema {
  chunks: {
    key: string;
    value: Chunk;
  };
  reviewStates: {
    key: string;
    value: ReviewState;
  };
  attempts: {
    key: string;
    value: Attempt;
    indexes: {
      'by-studyDate': string;
      'by-sessionId': string;
      'by-chunkId': string;
    };
  };
  sessions: {
    key: string;
    value: Session;
    indexes: {
      'by-studyDate': string;
    };
  };
  aiReports: {
    key: string;
    value: AiReport;
    indexes: {
      'by-sessionId': string;
      'by-status': string;
    };
  };
  settings: {
    key: string;
    value: Settings & { id: string };
  };
  coachMessages: {
    key: string;
    value: CoachMessage;
  };
}

let dbPromise: Promise<IDBPDatabase<RewireDBSchema>> | null = null;

/**
 * IndexedDB インスタンスを取得（初回にストア作成）
 */
export function getDatabase(): Promise<IDBPDatabase<RewireDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<RewireDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('chunks')) {
          db.createObjectStore('chunks', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('reviewStates')) {
          db.createObjectStore('reviewStates', { keyPath: 'chunkId' });
        }
        if (!db.objectStoreNames.contains('attempts')) {
          const store = db.createObjectStore('attempts', { keyPath: 'id' });
          store.createIndex('by-studyDate', 'studyDate');
          store.createIndex('by-sessionId', 'sessionId');
          store.createIndex('by-chunkId', 'chunkId');
        }
        if (!db.objectStoreNames.contains('sessions')) {
          const store = db.createObjectStore('sessions', { keyPath: 'id' });
          store.createIndex('by-studyDate', 'studyDate');
        }
        if (!db.objectStoreNames.contains('aiReports')) {
          const store = db.createObjectStore('aiReports', { keyPath: 'id' });
          store.createIndex('by-sessionId', 'sessionId');
          store.createIndex('by-status', 'status');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('coachMessages')) {
          db.createObjectStore('coachMessages', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * テスト用にDB接続キャッシュをリセット・クリアする
 */
export async function clearAllStoresForTest(): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(
    [
      'chunks',
      'reviewStates',
      'attempts',
      'sessions',
      'aiReports',
      'settings',
      'coachMessages',
    ],
    'readwrite'
  );
  await Promise.all([
    tx.objectStore('chunks').clear(),
    tx.objectStore('reviewStates').clear(),
    tx.objectStore('attempts').clear(),
    tx.objectStore('sessions').clear(),
    tx.objectStore('aiReports').clear(),
    tx.objectStore('settings').clear(),
    tx.objectStore('coachMessages').clear(),
    tx.done,
  ]);
}

/**
 * 起動時に永続化ストレージを要求する（要件6-8）
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.persist === 'function'
    ) {
      return await navigator.storage.persist();
    }
  } catch {
    // 非対応ブラウザでは無視
  }
  return false;
}

/**
 * 既存のシードチャンクの解説（coreImageJa / pronunciationTip）を最新のシード定義でアップグレードする
 */
export function upgradeSeedChunksWithLatestExplanations(chunks: Chunk[]): {
  chunks: Chunk[];
  changed: boolean;
} {
  const seedMap = new Map<string, Chunk>(ALL_SEED_CHUNKS.map((s) => [s.id, s]));
  let changed = false;
  const updated = chunks.map((c) => {
    const latestSeed = seedMap.get(c.id);
    if (
      latestSeed &&
      (c.coreImageJa !== latestSeed.coreImageJa ||
        c.pronunciationTip !== latestSeed.pronunciationTip)
    ) {
      changed = true;
      return {
        ...c,
        coreImageJa: latestSeed.coreImageJa,
        pronunciationTip: latestSeed.pronunciationTip,
      };
    }
    return c;
  });
  return { chunks: updated, changed };
}

/**
 * 初期シードデータと初期設定を投入し、全データを読み込む
 */
export async function initializeAndLoadAppData(): Promise<{
  settings: Settings;
  chunks: Chunk[];
  reviewStates: ReviewState[];
  attempts: Attempt[];
  sessions: Session[];
  aiReports: AiReport[];
  coachMessages: CoachMessage[];
}> {
  await requestPersistentStorage();
  const db = await getDatabase();

  // 設定の初期化
  let settingsRow = await db.get('settings', 'current');
  if (!settingsRow) {
    settingsRow = { ...DEFAULT_SETTINGS, id: 'current' };
    await db.put('settings', settingsRow);
  }
  const { id: _ignoreId, ...settings } = settingsRow;

  // シード問題の初期投入および解説の最新化
  let chunks = await db.getAll('chunks');
  if (chunks.length === 0) {
    const tx = db.transaction('chunks', 'readwrite');
    for (const seed of ALL_SEED_CHUNKS) {
      await tx.store.put(seed);
    }
    await tx.done;
    chunks = [...ALL_SEED_CHUNKS];
  } else {
    const upgraded = upgradeSeedChunksWithLatestExplanations(chunks);
    if (upgraded.changed) {
      const tx = db.transaction('chunks', 'readwrite');
      for (const c of upgraded.chunks) {
        await tx.store.put(c);
      }
      await tx.done;
      chunks = upgraded.chunks;
    }
  }

  const [reviewStates, attempts, sessions, aiReports, coachMessages] =
    await Promise.all([
      db.getAll('reviewStates'),
      db.getAll('attempts'),
      db.getAll('sessions'),
      db.getAll('aiReports'),
      db.getAll('coachMessages'),
    ]);

  return {
    settings,
    chunks,
    reviewStates,
    attempts,
    sessions,
    aiReports,
    coachMessages,
  };
}

/**
 * 要件6-5：1問ごとの自動保存
 * Attempt、ReviewState、Session.activeSeconds を1つのトランザクションでアトミックに保存する
 */
export async function saveQuestionProgressTransaction(params: {
  attempt: Attempt;
  reviewState?: ReviewState;
  session: Session;
}): Promise<void> {
  const { attempt, reviewState, session } = params;
  const db = await getDatabase();
  const tx = db.transaction(
    ['attempts', 'reviewStates', 'sessions'],
    'readwrite'
  );

  await tx.objectStore('attempts').put(attempt);
  if (reviewState) {
    await tx.objectStore('reviewStates').put(reviewState);
  }
  await tx.objectStore('sessions').put(session);
  await tx.done;
}

/**
 * 設定を保存する
 */
export async function saveSettingsToDb(settings: Settings): Promise<void> {
  const db = await getDatabase();
  await db.put('settings', { ...settings, id: 'current' });
}

/**
 * チャンク（新規AI生成・Live弱点・不自然無効化など）を保存する
 */
export async function saveChunksToDb(chunks: Chunk[]): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction('chunks', 'readwrite');
  for (const chunk of chunks) {
    await tx.store.put(chunk);
  }
  await tx.done;
}

/**
 * セッションを保存する
 */
export async function saveSessionToDb(session: Session): Promise<void> {
  const db = await getDatabase();
  await db.put('sessions', session);
}

/**
 * AIレポートを保存する
 */
export async function saveAiReportToDb(report: AiReport): Promise<void> {
  const db = await getDatabase();
  await db.put('aiReports', report);
}

/**
 * AIコーチ質問メッセージを保存する
 */
export async function saveCoachMessageToDb(msg: CoachMessage): Promise<void> {
  const db = await getDatabase();
  await db.put('coachMessages', msg);
}
