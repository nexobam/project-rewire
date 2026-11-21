-- Project Rewire D1 同期用テーブル定義
CREATE TABLE IF NOT EXISTS sync_store (
  store_key TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
