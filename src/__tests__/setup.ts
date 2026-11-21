// Vitest テストセットアップ（fake-indexeddb + jest-dom + デフォルトプロファイル設定）
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
import { setActiveDatabaseProfile } from '../db/database';
import { selectActiveProfile } from '../services/profileService';

beforeEach(() => {
  // 既存の統合テスト（App直描画）がプロファイル選択画面で止まらないようデフォルト M を設定
  if (typeof window !== 'undefined' && window.localStorage) {
    selectActiveProfile('M');
  }
  setActiveDatabaseProfile('M');
});
