// JSONバックアップ（APIキー除外）および防御的インポート（10MB制限・プロトタイプ汚染阻止・zod検証・比較プレビュー）

import { z } from 'zod';
import {
  CURRENT_SCHEMA_VERSION,
  ICON_WHITELIST,
  type AiReport,
  type Attempt,
  type Chunk,
  type CoachMessage,
  type ReviewState,
  type Session,
  type Settings,
} from '../types';
import { getDatabase } from './database';
import { migrateBackupData } from './migration';

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 10MB
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * オブジェクトツリーを再帰的に走査し、__proto__ / constructor / prototype キーが含まれていれば例外を投げる
 */
export function assertNoPrototypePollution(value: unknown): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoPrototypePollution(item);
    }
    return;
  }

  const ownKeys = Object.getOwnPropertyNames(value);
  for (const key of ownKeys) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`セキュリティエラー：禁止されたキー (${key}) が含まれています。`);
    }
    const child = (value as Record<string, unknown>)[key];
    assertNoPrototypePollution(child);
  }
}

// バックアップ検証用 zod スキーマ
const BlockSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

const ChunkSchema = z.object({
  id: z.string().min(1),
  level: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
  ]),
  contentCategory: z.enum(['daily', 'heat']),
  sceneCategory: z.string().min(1),
  grammarPattern: z.string().min(1),
  enText: z.string().min(1),
  blocks: z.array(BlockSchema),
  acceptableOrders: z.array(z.array(z.string())),
  speakOnly: z.boolean(),
  visual: z.object({
    icons: z.tuple([
      z.enum(ICON_WHITELIST),
      z.enum(ICON_WHITELIST),
    ]),
    tags: z.tuple([z.string(), z.string(), z.string()]),
  }),
  coreImageJa: z.string(),
  pronunciationTip: z.string(),
  hasSoundChange: z.boolean(),
  source: z.enum(['seed', 'ai', 'recomposed', 'live']),
  isCore: z.boolean(),
  disabled: z.boolean(),
  createdAt: z.string(),
  promptAudioText: z.string().optional(),
  ngWords: z.array(z.string()).optional(),
  soundChangeChoices: z.array(z.string()).optional(),
});

const RatingSchema = z.enum(['green', 'yellow', 'red']);

const ReviewStateSchema = z.object({
  chunkId: z.string().min(1),
  stage: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
  ]),
  dueDate: z.string().min(1),
  graduated: z.boolean(),
  spotCheckDate: z.string().optional(),
  recentRatings: z.array(RatingSchema),
  wordOrderRatings: z.array(RatingSchema).optional(),
});

const AttemptSchema = z.object({
  id: z.string().min(1),
  chunkId: z.string().min(1),
  sessionId: z.string().min(1),
  exerciseType: z.enum([
    'picture_choice',
    'sound_change',
    'word_order',
    'speak',
    'chunk_building',
    'paraphrase',
    'listening_long',
  ]),
  studyDate: z.string().min(1),
  startedAt: z.number(),
  reactionMs: z.number().nullable(),
  completionMs: z.number().nullable(),
  replayBeforeShown: z.number(),
  replayAfterShown: z.number(),
  rating: RatingSchema,
  missType: z.enum(['sound_change', 'order_delay', 'speech_block']).optional(),
  inputMode: z.enum(['silent', 'voice']),
  selfJudged: z.boolean(),
  sttTranscript: z.string().optional(),
  sttMatch: z.number().optional(),
  isSleepPriming: z.boolean().optional(),
});

const SessionSchema = z.object({
  id: z.string().min(1),
  mode: z.enum([
    'silent',
    'speak',
    'live',
    'sleep',
    'boss',
    'diagnosis',
    'rehab',
  ]),
  plannedMinutes: z.number(),
  activeSeconds: z.number(),
  studyDate: z.string().min(1),
  startedAt: z.number(),
  endedAt: z.number().optional(),
});

const AiReportSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  studyDate: z.string().optional(),
  status: z.enum(['pending', 'done', 'failed']),
  retryCount: z.number(),
  analyst: z
    .object({
      bottleneck: z.string(),
      growth: z.string(),
    })
    .optional(),
  teacher: z
    .array(
      z.object({
        coreImage: z.string(),
        pronunciation: z.string(),
        praise: z.string(),
      })
    )
    .optional(),
  liveLog: z
    .object({
      durationMinutes: z.number(),
      overallReview: z.string(),
      goodPoints: z.array(z.string()),
      badPoints: z.array(z.string()),
      fluencyScore: z.number(),
      weakChunks: z.array(z.string()),
    })
    .optional(),
  createdAt: z.number(),
});

const SettingsWithoutKeySchema = z.object({
  schemaVersion: z.number(),
  level: z.union([
    z.literal(0),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
  ]),
  lv1Phase: z.enum(['picture', 'blocks']),
  perTapMs: z.number().min(350).max(700),
  geminiModel: z.string().min(1),
  dailyApiCallLimit: z.number().min(1),
  ttsRate: z.number().min(0.7).max(1.2),
  clickSound: z.boolean(),
  themePreference: z.enum(['auto', 'light', 'dark']),
  lastBackupAt: z.number().optional(),
  restTickets: z.number().min(0).max(2),
  apiCallDate: z.string().optional(),
  apiCallCount: z.number().optional(),
  bossCooldownUntil: z.number().optional(),
  lastTicketRefillWeek: z.string().optional(),
  lastEvaluatedStudyDate: z.string().optional(),
  allEnglishMode: z.boolean().optional(),
  levelPromotedAt: z.number().optional(),
  firstUsedAt: z.number().optional(),
});

const CoachMessageSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().optional(),
  examples: z.array(z.string()).optional(),
  status: z.enum(['pending_offline', 'answered']),
  createdAt: z.number(),
});

const BackupBundleSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  exportedAt: z.string(),
  settings: SettingsWithoutKeySchema,
  chunks: z.array(ChunkSchema),
  reviewStates: z.array(ReviewStateSchema),
  attempts: z.array(AttemptSchema),
  sessions: z.array(SessionSchema),
  aiReports: z.array(AiReportSchema),
  coachMessages: z.array(CoachMessageSchema).optional().default([]),
});

export type ValidatedBackupBundle = z.infer<typeof BackupBundleSchema>;

/**
 * 現在のアプリデータをJSON文字列へエクスポートする
 * - schemaVersion を含める
 * - geminiApiKey は絶対に除外する（要件6-8・要件8-3）
 */
export async function exportBackupJson(params: {
  settings: Settings;
  chunks: Chunk[];
  reviewStates: ReviewState[];
  attempts: Attempt[];
  sessions: Session[];
  aiReports: AiReport[];
  coachMessages?: CoachMessage[];
}): Promise<string> {
  const { geminiApiKey: _excludedKey, ...safeSettings } = params.settings;

  const payload: ValidatedBackupBundle = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      ...safeSettings,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    },
    chunks: params.chunks,
    reviewStates: params.reviewStates,
    attempts: params.attempts,
    sessions: params.sessions,
    aiReports: params.aiReports,
    coachMessages: params.coachMessages ?? [],
  };

  return JSON.stringify(payload, null, 2);
}

export interface ImportComparisonSummary {
  currentTotalMinutes: number;
  currentLastStudyDate: string;
  incomingTotalMinutes: number;
  incomingLastStudyDate: string;
  bundle: ValidatedBackupBundle;
}

/**
 * セッション一覧から累計学習時間（分）と最終学習日を算出する
 */
export function summarizeStudyHistory(sessions: Session[]): {
  totalMinutes: number;
  lastStudyDate: string;
} {
  if (sessions.length === 0) {
    return { totalMinutes: 0, lastStudyDate: '記録なし' };
  }
  const totalSeconds = sessions.reduce(
    (acc, s) => acc + (Number.isFinite(s.activeSeconds) ? s.activeSeconds : 0),
    0
  );
  const dates = sessions.map((s) => s.studyDate).sort();
  return {
    totalMinutes: Math.round(totalSeconds / 60),
    lastStudyDate: dates[dates.length - 1] ?? '記録なし',
  };
}

/**
 * JSON文字列を厳格に検査・パース・マイグレーションし、
 * 現在データとインポート先データの比較サマリーを返す（まだDBは上書きしない）
 */
export function validateAndPreviewImportJson(
  rawJsonText: string,
  currentSessions: Session[]
): ImportComparisonSummary {
  if (typeof rawJsonText !== 'string') {
    throw new Error('入力データが文字列ではありません。');
  }

  // 1. 10MBサイズ上限チェック
  const byteLength = new TextEncoder().encode(rawJsonText).byteLength;
  if (byteLength > MAX_IMPORT_BYTES) {
    throw new Error('ファイルサイズが上限（10MB）を超えています。');
  }

  // 2. JSONパース（reviverで禁止キーを厳格検査。文字列内の偶発的な語句での誤検知は防ぐ）
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJsonText, (key, value) => {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new Error(`禁止されたキー (${key}) が検出されました。`);
      }
      return value;
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('禁止されたキー')) {
      throw err;
    }
    throw new Error('不正なJSON形式です。');
  }

  // 4. オブジェクトツリーの再帰的プロトタイプ汚染検査
  assertNoPrototypePollution(parsed);

  // 5. schemaVersion 検査とマイグレーション
  const migrated = migrateBackupData(parsed);

  // 6. インポートデータ内に万一 geminiApiKey が含まれていても強制削除
  if (migrated.settings && 'geminiApiKey' in migrated.settings) {
    delete migrated.settings.geminiApiKey;
  }

  // 7. zod スキーマ検証
  const result = BackupBundleSchema.safeParse(migrated);
  if (!result.success) {
    throw new Error(
      `データ構造がスキーマと一致しません: ${result.error.issues[0]?.message ?? '不明なエラー'}`
    );
  }

  const bundle = result.data;
  const currentSummary = summarizeStudyHistory(currentSessions);
  const incomingSummary = summarizeStudyHistory(bundle.sessions);

  return {
    currentTotalMinutes: currentSummary.totalMinutes,
    currentLastStudyDate: currentSummary.lastStudyDate,
    incomingTotalMinutes: incomingSummary.totalMinutes,
    incomingLastStudyDate: incomingSummary.lastStudyDate,
    bundle,
  };
}

/**
 * 確認ダイアログで承認された後、検証済みバックアップデータをIndexedDBに反映する
 * （現在のAPIキーは維持する）
 */
export async function commitValidatedBackupToDb(
  bundle: ValidatedBackupBundle,
  existingApiKey?: string
): Promise<Settings> {
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
    tx.objectStore('coachMessages').clear(),
  ]);

  for (const chunk of bundle.chunks) {
    await tx.objectStore('chunks').put(chunk);
  }
  for (const rs of bundle.reviewStates) {
    await tx.objectStore('reviewStates').put(rs);
  }
  for (const att of bundle.attempts) {
    await tx.objectStore('attempts').put(att);
  }
  for (const sess of bundle.sessions) {
    await tx.objectStore('sessions').put(sess);
  }
  for (const rep of bundle.aiReports) {
    await tx.objectStore('aiReports').put(rep);
  }
  for (const msg of bundle.coachMessages) {
    await tx.objectStore('coachMessages').put(msg);
  }

  const mergedSettings: Settings = {
    ...bundle.settings,
    geminiApiKey: existingApiKey,
  };
  await tx.objectStore('settings').put({ ...mergedSettings, id: 'current' });
  await tx.done;

  return mergedSettings;
}
