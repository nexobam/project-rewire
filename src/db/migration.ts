// データスキーマのバージョン管理およびマイグレーションロジック

import { CURRENT_SCHEMA_VERSION, DEFAULT_SETTINGS } from '../types';

export interface RawBackupPayload {
  schemaVersion?: number;
  exportedAt?: string;
  settings?: Record<string, unknown>;
  chunks?: unknown[];
  reviewStates?: unknown[];
  attempts?: unknown[];
  sessions?: unknown[];
  aiReports?: unknown[];
  coachMessages?: unknown[];
}

/**
 * インポートデータの schemaVersion を検査し、
 * - 新しすぎるバージョン（> CURRENT_SCHEMA_VERSION）は拒否
 * - 古いバージョン（< CURRENT_SCHEMA_VERSION、例: 0）はマイグレーション変換して返す
 */
export function migrateBackupData(raw: unknown): RawBackupPayload {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('バックアップデータの形式が不正です。');
  }

  const record = raw as Record<string, unknown>;
  const version = record.schemaVersion;

  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new Error('schemaVersion が欠落しているか不正です。');
  }

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `未対応の新しいバージョン (v${version}) のデータです。現在の対応バージョンは v${CURRENT_SCHEMA_VERSION} です。`
    );
  }

  // v0 -> v1 マイグレーション（古い形式のデフォルト補完）
  if (version === 0) {
    const rawSettings =
      record.settings && typeof record.settings === 'object'
        ? (record.settings as Record<string, unknown>)
        : {};

    return {
      ...record,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt:
        typeof record.exportedAt === 'string'
          ? record.exportedAt
          : new Date().toISOString(),
      settings: {
        ...DEFAULT_SETTINGS,
        ...rawSettings,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      },
      chunks: Array.isArray(record.chunks) ? record.chunks : [],
      reviewStates: Array.isArray(record.reviewStates) ? record.reviewStates : [],
      attempts: Array.isArray(record.attempts) ? record.attempts : [],
      sessions: Array.isArray(record.sessions) ? record.sessions : [],
      aiReports: Array.isArray(record.aiReports) ? record.aiReports : [],
      coachMessages: Array.isArray(record.coachMessages)
        ? record.coachMessages
        : [],
    };
  }

  return record as RawBackupPayload;
}
