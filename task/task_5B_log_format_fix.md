# Task 5B: ログの表示まわりの小さな修正（日時の書式・文字化け）

- ブランチ / Worktree: `feat/5b-log-format` / `../msync-wt-5b`（main から作成）
- セキュリティ分類: A（ログの書式の変更のみ。通信・トークンに関与しない）
- 進め方: **red/green TDD**（テストで書式を固定してから実装する）。テストを弱める変更は禁止
- 起点: `起点：バグ/5A-last-run-format/採用`

## 背景（実機の確認で見つかった2点・どちらも運用には影響しない軽い不具合）
1. `logs/last_run.txt` の日時が「2026-10-11 134925 (JST)」と、時刻のコロンがない。指示書（Task 5A）では `YYYY-MM-DD HH:mm:ss`
   - 原因: `src/ops/weekly.js` の `jstDateTime()` が、ファイル名用の `jstTimestamp()`（`YYYY-MM-DD_HHmmss`）の `_` を空白に置き換えているだけで、時刻部分の `HHmmss` を `HH:mm:ss` にしていない
2. PowerShell 5.1 の `type logs\last_run.txt` で、日本語が文字化けして見える
   - 原因: `last_run.txt` と `weekly_*.log` が、BOM なしの UTF-8。PowerShell 5.1 は BOM がないと、日本語の文字コード（ANSI）として読む
   - ファイルの中身自体は正しい UTF-8（Node.js や VS Code では正しく読める）

## Task boundary
- 変更: `src/ops/weekly.js`、`test/ops/weekly.test.js`、`README.md`（下記の一文のみ）
- 触らない: 上記以外すべて（`src/index.js`、`src/sync/**`、`src/nhk/**`、`src/match/**`、`src/spotify/**`、`scripts/**`、依存追加）

## 実装要件
1. `jstDateTime(now)` を `YYYY-MM-DD HH:mm:ss`（例: `2026-10-11 13:49:25`）にする。`jstTimestamp(now)`（ファイル名用 `YYYY-MM-DD_HHmmss`）は**変更しない**（ログのファイル名は従来のまま）
2. `last_run.txt` に、**開始時刻と終了時刻**の両方を書く（現状は、開始時刻を「日時」として書いている）
   ```
   結果: 成功
   開始: 2026-10-11 13:49:25 (JST)
   終了: 2026-10-11 13:49:41 (JST)
   追加曲数: 0
   未マッチ数: 0
   ```
   - 終了時刻は、処理が終わった時点の `new Date()`（テストでは注入できるように、時刻を返す関数を引数で受け取る）
   - `buildLastRunText` の引数名・戻り値の形は、テストで固定する
3. `last_run.txt` と `weekly_*.log` を、**UTF-8 の BOM 付き**で書く（先頭に `﻿`）。PowerShell 5.1 の `type` で日本語が正しく表示される
   - ログの中身の読み取り（`cleanupOldLogs` など）に影響しないこと
4. README の「ログと再認証」の `Get-Content ... -Encoding UTF8` の案内を、「`type logs\last_run.txt` でも読めます」に更新する（その一文のみ。ほかの README の内容は変更しない）

## テスト（先に書く）
- `jstDateTime`: `2026-10-11T04:49:25Z`（UTC）→ `2026-10-11 13:49:25`。日付をまたぐ場合（`2026-10-10T15:30:00Z` → JST の `2026-10-11 00:30:00`）
- `jstTimestamp` が従来どおり `2026-10-11_134925` を返す（回帰）
- `buildLastRunText`: 開始・終了の両方、成功時と失敗時（理由つき）
- `runWeekly` が書く `last_run.txt` と `weekly_*.log` の先頭 3 バイトが、BOM（`EF BB BF`）である
- 既存の `weekly.test.js` のテストが、そのまま通る（壊さない）

## 完了条件
- `node --test` 全件通過（Red / Green ログ貼付。件数は 201 件から増える）
- 実機確認は、メインのフォルダで `node scripts/weekly_sync.js` を **1回だけ**実行する（PR のマージ後。新着がなければ追加 0 曲）。`type logs\last_run.txt` で、日本語が文字化けせず、日時が `HH:mm:ss` になっていることを示す
  - ユーザーの実機の操作が必要なので、PR を作ったところで一度止まって、ユーザーに依頼する
- コミット → push → PR作成（`gh pr create --body-file`）→ CIグリーン確認。**マージはしない**
- Work_Report: `workReport/2026-10-xx_task_5B_log_format_fix.md`。「動作確認結果」に未実施を残さない（ユーザー操作待ちで止まる場合は、その旨と再開条件を明記）
- ターミナルは PowerShell 5.1。`&&` で連結しない。日本語を含むファイルの編集に `Get-Content` / `Set-Content` を使わない
