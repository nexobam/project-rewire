# Project Rewire テスト仕様書（v1.0）

## 1. テスト方針と実行環境
* **テストフレームワーク**：Vitest + `@testing-library/react` + `jsdom` + `fake-indexeddb`
* **カバレッジ基準**：ビジネスロジック層（`src/domain/**/*.ts`）の行カバレッジ（Lines）80%以上（実測値：**91%以上**）
* **実行コマンド**：`npm run test`

---

## 2. テストファイルとテストケース一覧（正常系・異常系・境界値）

| テストファイル | 対象モジュール | テストケース（観点・境界値） | 区分 | 結果 |
|---|---|---|---|---|
| `src/__tests__/timingJudge.test.ts` | `src/domain/timingJudge.ts` | `perTapMs` の中央値算出と `350〜700ms` クランプ（200ms→350ms, 950ms→700ms, NaN→500ms） | 境界値・異常系 | PASS |
| `src/__tests__/timingJudge.test.ts` | `src/domain/timingJudge.ts` | 語順ブロック判定境界：初動 `1200ms` / `1201ms`、完了 `completionBudget` / `completionBudget + 1ms` / `completionBudget + 1500ms` / `+ 1501ms` | 境界値 | PASS |
| `src/__tests__/timingJudge.test.ts` | `src/domain/timingJudge.ts` | 絵カード・音変化判定境界：`1500ms`（緑）/ `1501ms`（黄）/ `3000ms`（黄）/ `3001ms`（赤） | 境界値 | PASS |
| `src/__tests__/timingJudge.test.ts` | `src/domain/timingJudge.ts` | 轟音リプレイ救済：選択肢表示前1回は緑維持、表示前2回以上または表示後リプレイ時は最高評価が黄にキャップされること | 正常系・境界値 | PASS |
| `src/__tests__/timingJudge.test.ts` | `src/domain/timingJudge.ts` | `acceptableOrders` の複数正解語順判定と不正解・空配列の拒否 | 正常系・異常系 | PASS |
| `src/__tests__/srs_and_date.test.ts` | `src/domain/studyDate.ts`, `src/domain/srs.ts` | 午前4時の日付境界：ローカル時刻 `03:59:59` は前日、`04:00:00` は当日として判定されること | 境界値 | PASS |
| `src/__tests__/srs_and_date.test.ts` | `src/domain/srs.ts` | SRS段階 `[1, 3, 7, 14, 30]` 日の遷移、段階4緑での卒業（`graduated: true`）と90日後抜き打ち設定、黄での同段階維持、赤での段階0リセットと卒業取消 | 正常系・境界値 | PASS |
| `src/__tests__/srs_and_date.test.ts` | `src/domain/studyDate.ts` | 毎週月曜午前4時のお休みチケット補充（最大2枚）、未学習日の自動1枚消費による連続記録維持、2日以上空いた場合の「3分リハビリ」提案 | 正常系・境界値 | PASS |
| `src/__tests__/shuffle.test.ts` | `src/domain/shuffle.ts` | 通常文および複数正解文で **10,000回試行** して `acceptableOrders` のいずれとも1度も一致しないこと | 境界値・確率検証 | PASS |
| `src/__tests__/shuffle.test.ts` | `src/domain/shuffle.ts` | 同じ単語が重複する文（`"that"` 2回出現）でBlock IDが保持され、**10,000回試行** して正解並びと1度も一致しないこと、およびフォールバック探索分岐 | 正常系・境界値 | PASS |
| `src/__tests__/scheduler.test.ts` | `src/domain/scheduler.ts` | 15問バッチ編成において同じ `grammarPattern` または同じ `sceneCategory` が2問連続しないこと（インターリービング） | 正常系 | PASS |
| `src/__tests__/scheduler.test.ts` | `src/domain/scheduler.ts` | 連続バッチ選出時の直近100問において Miami Heat の割合が `15%±5%`（10〜20問）に収まること | 境界値 | PASS |
| `src/__tests__/scheduler.test.ts` | `src/domain/scheduler.ts` | 新規問題枯渇時に既存チャンクから `source: 'recomposed'` を自動生成して無限に出題できること | 異常系・代替動作 | PASS |
| `src/__tests__/promotionGate.test.ts` | `src/domain/promotionGate.ts` | Lv.1前半（絵カード期）→後半（語順ブロック期）移行条件（直近30問で正答率85%以上かつ緑60%以上、29問では未移行） | 境界値 | PASS |
| `src/__tests__/promotionGate.test.ts` | `src/domain/promotionGate.ts` | 昇格ゲート①が語順ブロック形式（`word_order`）だけで集計され、絵カード評価や後から追加された非コアAI問題が分母・分子に入らないこと | 正常系・異常系 | PASS |
| `src/__tests__/promotionGate.test.ts` | `src/domain/promotionGate.ts` | Lv.2〜4昇格時にコアセットが40チャンクで確定・固定されること | 正常系 | PASS |
| `src/__tests__/promotionGate.test.ts` | `src/domain/promotionGate.ts` | ETA表示：学習3日未満で「データ収集中」、分母0で「停滞中（予測不可）」、通常時の予測日数算出 | 境界値・異常系 | PASS |
| `src/__tests__/promotionGate.test.ts` | `src/domain/promotionGate.ts` | ボス戦：全10問の構成比率（4問＋6問）、黄以内8問以上で合格、7問以下で不合格＆24時間クールダウン＆失敗チャンク抽出 | 境界値 | PASS |
| `src/__tests__/liveParser.test.ts` | `src/domain/liveParser.ts` | 前後に雑談が混ざるテキスト・コードフェンス内からのJSON抽出、3語以上→語順問題／3語未満→発話専用（`speakOnly: true`）の振り分け | 正常系・境界値 | PASS |
| `src/__tests__/liveParser.test.ts` | `src/domain/liveParser.ts` | `weakChunks` 6件以上→5件への切り詰め、40文字超・日本語混入の除外、`durationMinutes` 範囲外（120分）→20分へのフォールバック、壊れたJSONの拒否 | 異常系・境界値 | PASS |
| `src/__tests__/aiValidator_and_stt.test.ts` | `src/domain/aiValidator.ts`, `src/domain/sttMatcher.ts` | AI出力の7つの拒否条件（zod不一致、ホワイトリスト外アイコン、タグ数≠3または8文字超、`enText` > 80文字、ブロック3〜9外、`acceptableOrders` に自身の並びなし、直近20件と重複）の完全排除 | 異常系・境界値 | PASS |
| `src/__tests__/aiValidator_and_stt.test.ts` | `src/data/seed/*.json` | 初期同梱シードデータ全60問（Lv.0:15問、Lv.1:30問、Lv.2〜4:各5問）のスキーマ・タグ文字数・アイコン・`acceptableOrders` 完全検証 | 正常系 | PASS |
| `src/__tests__/aiValidator_and_stt.test.ts` | `src/domain/sttMatcher.ts` | STT一致率（小文字化・句読点除去・単語単位80%境界）と自己判定優先（STT不一致でも自己判定の緑が優先されること）、Lv.3 NGワード検出 | 正常系・境界値 | PASS |
| `src/__tests__/security_and_backup.test.ts` | `src/db/backup.ts`, `src/services/logger.ts`, `src/db/database.ts` | エクスポートJSONおよびロガーからのAPIキー完全除外、`__proto__` / `constructor` / `prototype` プロトタイプ汚染拒否、10MB超拒否、v0マイグレーションと未来バージョンv99拒否、1問ごとのアトミックトランザクション保存 | セキュリティ・異常系 | PASS |
| `src/__tests__/fallback_and_ui.test.tsx` | `src/domain/contrast.ts`, `src/services/*`, `src/components/*` | 昼・夜・スリープ全カラートークンの文字/背景コントラスト比 WCAG AA（4.5:1以上）、`IconName` 全60種の実在確認、APIキー未設定・429エラー時のモック代替、TTS `onend` 未発火時のタイムアウト完了発火、語順ブロックのプレースホルダーによるレイアウトシフト防止、PCキーボード（`1〜9`, `Backspace`, `Space`）操作 | UI・代替動作・アクセシビリティ | PASS |
