// セキュリティテスト（JSONインポート防御：プロトタイプ汚染・10MB超過・バージョン違い・APIキー非漏洩・1問ごとのトランザクション保存）

import { beforeEach, describe, expect, it } from 'vitest';
import {
  commitValidatedBackupToDb,
  exportBackupJson,
  MAX_IMPORT_BYTES,
  validateAndPreviewImportJson,
} from '../db/backup';
import {
  clearAllStoresForTest,
  initializeAndLoadAppData,
  saveQuestionProgressTransaction,
} from '../db/database';
import { createInitialReviewState } from '../domain/srs';
import { maskSensitiveText } from '../services/logger';
import { DEFAULT_SETTINGS, type Attempt, type Session } from '../types';

describe('security & backup - インポート防御・APIキー保護・DBトランザクション', () => {
  beforeEach(async () => {
    await clearAllStoresForTest();
  });

  it('エクスポートされたJSONに schemaVersion が含まれ、geminiApiKey が絶対に漏れないこと', async () => {
    const data = await initializeAndLoadAppData();
    const secretKey = 'AIzaSySecretTestKey1234567890ABCDEF';
    const settingsWithKey = {
      ...data.settings,
      geminiApiKey: secretKey,
    };

    const exported = await exportBackupJson({
      settings: settingsWithKey,
      chunks: data.chunks.slice(0, 2),
      reviewStates: data.reviewStates,
      attempts: data.attempts,
      sessions: data.sessions,
      aiReports: data.aiReports,
      coachMessages: data.coachMessages,
    });

    expect(exported).toContain('"schemaVersion": 1');
    expect(exported).not.toContain(secretKey);
    expect(exported).not.toContain('geminiApiKey');
  });

  it('ロガーのマスク処理がAPIキー文字列・AIzaパターン・URLのkeyパラメータ・Bearerトークンをすべてマスクすること', () => {
    const rawKey = 'my-custom-gemini-secret-key-999';
    const msg = `Error calling https://example.com/api?key=AIzaSy1234567890123456789 with ${rawKey} and Bearer secret_token_xyz`;
    const masked = maskSensitiveText(msg, rawKey);

    expect(masked).not.toContain(rawKey);
    expect(masked).not.toContain('AIzaSy1234567890123456789');
    expect(masked).not.toContain('secret_token_xyz');
    expect(masked).toContain('***MASKED_API_KEY***');
  });

  it('JSONインポート防御：プロトタイプ汚染（__proto__ / constructor / prototype）、10MB超、不正JSON、未来のschemaVersionをすべて拒否すること', async () => {
    const data = await initializeAndLoadAppData();
    const validExport = await exportBackupJson({
      settings: DEFAULT_SETTINGS,
      chunks: data.chunks.slice(0, 2),
      reviewStates: [],
      attempts: [],
      sessions: [],
      aiReports: [],
    });

    // 1. __proto__ を含むJSONの拒否
    const protoPolluted = validExport.replace(
      '"exportedAt":',
      '"__proto__": {"polluted": true}, "exportedAt":'
    );
    expect(() => validateAndPreviewImportJson(protoPolluted, [])).toThrow(
      /禁止されたキー/
    );

    // 2. constructor キーを含むJSONの拒否
    const constructorPolluted = validExport.replace(
      '"exportedAt":',
      '"constructor": {"prototype": {"polluted": true}}, "exportedAt":'
    );
    expect(() => validateAndPreviewImportJson(constructorPolluted, [])).toThrow(
      /禁止されたキー/
    );

    // 3. 10MBを超える巨大データの拒否
    const hugeString = 'a'.repeat(MAX_IMPORT_BYTES + 100);
    expect(() => validateAndPreviewImportJson(hugeString, [])).toThrow(
      /10MB/
    );

    // 4. 新しすぎるバージョン（schemaVersion: 99）の拒否
    const futureVersion = validExport.replace(
      '"schemaVersion": 1',
      '"schemaVersion": 99'
    );
    expect(() => validateAndPreviewImportJson(futureVersion, [])).toThrow(
      /未対応の新しいバージョン/
    );

    // 5. 古いバージョン（schemaVersion: 0）はマイグレーションで正常に変換・プレビューできること
    const oldVersion = validExport.replace(
      '"schemaVersion": 1',
      '"schemaVersion": 0'
    );
    const preview = validateAndPreviewImportJson(oldVersion, []);
    expect(preview.bundle.schemaVersion).toBe(1);

    // 6. 確認後のDBコミット時も既存のAPIキーが保護されること
    const mergedSettings = await commitValidatedBackupToDb(
      preview.bundle,
      'AIzaPreservedKey999999999'
    );
    expect(mergedSettings.geminiApiKey).toBe('AIzaPreservedKey999999999');
  });

  it('1問ごとの自動保存（Attempt, ReviewState, Session.activeSeconds）が1つのトランザクションで保存されること', async () => {
    await initializeAndLoadAppData();

    const session: Session = {
      id: 'sess_tx_1',
      mode: 'silent',
      plannedMinutes: 15,
      activeSeconds: 45,
      studyDate: '2026-11-20',
      startedAt: Date.now(),
    };
    const attempt: Attempt = {
      id: 'att_tx_1',
      chunkId: 'lv1_01',
      sessionId: 'sess_tx_1',
      exerciseType: 'word_order',
      studyDate: '2026-11-20',
      startedAt: Date.now(),
      reactionMs: 750,
      completionMs: 2100,
      replayBeforeShown: 0,
      replayAfterShown: 0,
      rating: 'green',
      inputMode: 'silent',
      selfJudged: false,
    };
    const reviewState = createInitialReviewState('lv1_01', '2026-11-20');

    await saveQuestionProgressTransaction({
      attempt,
      reviewState,
      session,
    });

    const reloaded = await initializeAndLoadAppData();
    expect(reloaded.attempts.some((a) => a.id === 'att_tx_1')).toBe(true);
    expect(reloaded.reviewStates.some((r) => r.chunkId === 'lv1_01')).toBe(
      true
    );
    expect(
      reloaded.sessions.find((s) => s.id === 'sess_tx_1')?.activeSeconds
    ).toBe(45);
  });
});
