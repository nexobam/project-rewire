# Project Rewire（v1.0）— 英語脳再配線PWAトレーナー

翻訳思考を完全に排除し、「状況ビジュアルカード」と「音」から直接英語を出力する回路を構築するための個人用PWA（Progressive Web App）です。

## 1. 主な特徴
* **6大絶対ルール実装**：日本語文の英訳出題ゼロ、音先行（Lv.1前半：絵カード期 → 後半：語順ブロック期）、個人のタップ速度（`perTapMs`）に基づく動的タイムリミット、コアイメージ＆発音フォーム解説、SRS（`[1, 3, 7, 14, 30]`日＋卒業90日後抜き打ち）＆インターリービング＆厳密シャッフル、実力昇格ゲート＆ボス戦。
* **コンテンツ比率自動制御**：日常会話 85% ： Miami Heat（NBA）15%（直近100問で15%±5%に自動制御）。
* **5つの学習モード**：サイレントモード、発話ドリルモード（お手本音声なし・自己判定＋STT補助）、Live実戦モード（プロンプト生成＆終了時JSONログパーサー）、スリープ・プライミングモード、AIコーチ質問チャット。
* **4人のAI社員（2ステップAPIパイプライン）**：データアナリスト、コアイメージ先生、カリキュラム職人（Call 1: temp 0.7）→ 7項目機械検証 → 独立品質チェッカー（Call 2: temp 0.2）。APIキー未設定・オフライン・429エラー時は自動的にローカルモックへフォールバック。

---

## 2. セットアップ・開発・テスト・ビルド手順

```bash
# 1. 依存パッケージのインストール
npm install

# 2. 開発サーバーの起動
npm run dev

# 3. 単体・結合・UI・セキュリティテスト＆カバレッジ計測（ロジック層80%以上）
npm run test

# 4. ESLint 静的解析（dangerouslySetInnerHTML 禁止チェック含む）
npm run lint

# 5. 本番用PWAビルド（dist/ にマニフェスト・Service Worker一式を生成）
npm run build

# 6. ビルド後のローカルプレビュー
npm run preview
```

---

## 3. 無料ホスティングへのデプロイ手順（ランニングコスト完全0円）

### A. Cloudflare Pages へのデプロイ
1. GitHub リポジトリに `project-rewire` をプッシュします。
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** を選択します。
3. ビルド設定を以下のように指定してデプロイします：
   * **Build command**: `npm run build`
   * **Build output directory**: `dist`
4. デプロイ完了後、発行された `https://*.pages.dev` のURLを iPhone Safari で開き、「共有」→「ホーム画面に追加」でPWAとしてインストールします。

### B. GitHub Pages へのデプロイ
1. `npx gh-pages -d dist` または GitHub Actions（`actions/upload-pages-artifact` + `actions/deploy-pages`）で `dist/` ディレクトリをデプロイします。
2. APIキーはビルド時に埋め込まず、デプロイ後のアプリの「設定」画面から入力してください（端末内のIndexedDBにのみ安全に保存されます）。

---

## 4. ドキュメント一覧（`docs/`）
* [docs/01_requirements.md](./docs/01_requirements.md) — 要件定義書
* [docs/02_functional_spec.md](./docs/02_functional_spec.md) — 機能仕様書
* [docs/03_detailed_design.md](./docs/03_detailed_design.md) — 詳細設計書
* [docs/04_test_spec.md](./docs/04_test_spec.md) — テスト仕様書
