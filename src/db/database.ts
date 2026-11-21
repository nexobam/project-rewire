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
      blocking() {
        dbPromise?.then((db) => db.close()).catch(() => undefined);
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
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

const KNOWN_MOCK_AI_EXPLANATIONS: Record<
  string,
  { coreImageJa: string; pronunciationTip: string }
> = {
  'Let me grab another cup of coffee.': {
    coreImageJa:
      '【言いたいこと】コーヒーをもう1杯もらおうかな ／ 【英語の語順】Let me grab（サッと手元に取らせて）→ another cup of coffee.（もう1杯のコーヒーを）',
    pronunciationTip: 'Let me はレミ、cup of はカッポヴと一息で連結する。',
  },
  'I will keep you posted on this.': {
    coreImageJa:
      '【言いたいこと】この件は随時アップデート（進捗報告）しますね ／ 【英語の語順】I will keep you posted（あなたを最新情報に触れた状態に保つ）→ on this.（この件に接触させて）',
    pronunciationTip: 'keep you はキーピュ、posted on はポースティドンと繋ぐ。',
  },
  'Miami pushed the pace in transition.': {
    coreImageJa:
      '【言いたいこと】マイアミが速攻（トランジション）で一気にペースを上げた ／ 【英語の語順】Miami pushed the pace（マイアミが速度を前へ押し出した）→ in transition.（攻守切替の中で）',
    pronunciationTip: 'pushed the はプッシュザと t を止めて th へ滑らせる。',
  },
  'I am heading back home right now.': {
    coreImageJa:
      '【言いたいこと】今ちょうど家に向かって帰っているところです ／ 【英語の語順】I am heading back home（頭を家の方へ戻して進んでいる）→ right now.（たった今）',
    pronunciationTip:
      'heading back の ng を軽く鼻に抜き、right now の t を止める。',
  },
  'I am totally good with that plan.': {
    coreImageJa:
      '【言いたいこと】そのプランで全く問題ない（大賛成）よ ／ 【英語の語順】I am totally good（私は完全に心地よい・OKだ）→ with that plan.（その計画と一緒にいて）',
    pronunciationTip:
      'totally の t はフラップで軽く弾き、good with を密着させる。',
  },
};

/**
 * 既存のシードチャンクおよび既知のAIモックチャンクの解説（coreImageJa / pronunciationTip）を最新定義でアップグレードする
 */
export function upgradeSeedChunksWithLatestExplanations(chunks: Chunk[]): {
  chunks: Chunk[];
  changed: boolean;
} {
  const seedById = new Map<string, Chunk>(
    ALL_SEED_CHUNKS.map((s) => [s.id, s])
  );
  const seedByEnText = new Map<string, Chunk>(
    ALL_SEED_CHUNKS.map((s) => [s.enText.trim(), s])
  );

  let changed = false;
  const updated = chunks.map((c) => {
    const latestSeed =
      seedById.get(c.id) ?? seedByEnText.get(c.enText.trim());
    if (latestSeed) {
      const seedOrderJson = JSON.stringify(latestSeed.acceptableOrders);
      const curOrderJson = JSON.stringify(c.acceptableOrders);
      const seedChoicesJson = JSON.stringify(latestSeed.soundChangeChoices ?? null);
      const curChoicesJson = JSON.stringify(c.soundChangeChoices ?? null);
      if (
        c.enText !== latestSeed.enText ||
        c.coreImageJa !== latestSeed.coreImageJa ||
        c.pronunciationTip !== latestSeed.pronunciationTip ||
        seedOrderJson !== curOrderJson ||
        seedChoicesJson !== curChoicesJson
      ) {
        changed = true;
        return {
          ...c,
          enText: latestSeed.enText,
          blocks: latestSeed.blocks,
          acceptableOrders: latestSeed.acceptableOrders,
          soundChangeChoices: latestSeed.soundChangeChoices,
          coreImageJa: latestSeed.coreImageJa,
          pronunciationTip: latestSeed.pronunciationTip,
        };
      }
      return c;
    }

    const knownMock = KNOWN_MOCK_AI_EXPLANATIONS[c.enText.trim()];
    if (
      knownMock &&
      (c.coreImageJa !== knownMock.coreImageJa ||
        c.pronunciationTip !== knownMock.pronunciationTip)
    ) {
      changed = true;
      return {
        ...c,
        coreImageJa: knownMock.coreImageJa,
        pronunciationTip: knownMock.pronunciationTip,
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

  // 設定の初期化（DEFAULT_SETTINGS で欠損フィールドを安全に補完）
  let settingsRow = await db.get('settings', 'current');
  if (!settingsRow) {
    settingsRow = {
      ...DEFAULT_SETTINGS,
      firstUsedAt: Date.now(),
      id: 'current',
    };
    await db.put('settings', settingsRow);
  }
  const { id: _ignoreId, ...rawSettings } = settingsRow;
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    firstUsedAt: rawSettings.firstUsedAt ?? Date.now(),
  };

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

/**
 * AIコーチ質問メッセージを1件削除する
 */
export async function deleteCoachMessageFromDb(id: string): Promise<void> {
  const db = await getDatabase();
  await db.delete('coachMessages', id);
}

/**
 * AIコーチ質問履歴をすべて削除する
 */
export async function clearCoachMessagesFromDb(): Promise<void> {
  const db = await getDatabase();
  await db.clear('coachMessages');
}
