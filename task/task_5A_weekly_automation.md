# Task 5A: 週次の自動実行とワンクリック実行

- **着手条件**: PR #8（4C）が main にマージ済みで、`git pull` 後に `node --test` が全件通過（185件）すること。ユーザーが `node src/index.js sync` を 1 回実行済みであること
- ブランチ / Worktree: `feat/5a-weekly-automation` / `../msync-wt-5a`
- セキュリティ分類: B（Spotify のトークンを使う処理を、無人で動かす）
- 進め方: red/green TDD（テストできる部分）。通信はテストでモック
- 起点: `起点：計画/Phase5-5A/採用`
- ユーザー決定（2026-10-10）: 週次の定期実行を自動化する。難しければワンクリック実行のショートカットでよい。**両方作る**

## 背景
- NHK「ミュージックライン」は月〜金の 21:45 に放送される。週に 1 回まとめて取り込めばよい（既定: **毎週土曜 9:00**）
- 取り込みの流れは `node src/index.js fetch` → `sync`（増分。state.json の処理済みは自動でスキップ）
- 実行場所は**メインのフォルダ**（`data/state.json` `data/spotify_token.json` `data/episodes.json` がここにある）。worktree では動かさない
- プレイリストは公開（ユーザー承認済み）。採点ルール・閾値60は変更しない

## Task boundary
- 新規: `src/ops/weekly.js`（実行の手順・ログ・ロックなど、テストできる部分）, `scripts/weekly_sync.js`（その呼び出し口）,
  `scripts/sync_now.bat`（ワンクリック用・対話式）, `scripts/weekly_sync.bat`（スケジューラ用の薄い起動口）,
  `scripts/register_weekly_task.ps1`（タスク登録・解除）, `test/ops/weekly.test.js`
- 変更（許可）: `src/index.js` と `src/sync/apply.js`（**`--max-add N` オプションの追加のみ**）、`README.md`（「運用」節の追記のみ）、`.gitignore`（`logs/` の追加のみ）
- 触らない: `src/nhk/**`, `src/match/**`, `src/spotify/**`, `src/sync/plan.js` `runMatch.js` `report.js` `state.js`, 依存追加

## 実装要件

### 1. 安全装置 `--max-add N`（`src/index.js` / `apply.js`）
- `sync` に `--max-add N` を追加。**書き込み前の追加予定曲数の合計が N を超えたら、1曲も書き込まずに終了コード2で終了**し、理由を表示
- 既定は無制限（従来動作を変えない）。無人実行では 50 を渡す
- テスト: 超過で書き込み系が呼ばれない / 以内なら従来どおり / 不正値（負数・非整数）はエラー

### 2. 無人実行 `scripts/weekly_sync.js` + `src/ops/weekly.js`
1. 実行ディレクトリに依らず、**スクリプトの位置からプロジェクトのルートを求めて**その場所で動く（パスのハードコード禁止）
2. ロックファイル（`data/weekly.lock`）で二重起動を防止。古いロック（6時間超）は無視して上書き。終了時に必ず削除
3. 順に実行: `fetch` → `sync --yes --max-add 50`。子プロセス（`process.execPath` で `src/index.js`）として実行し、標準出力・標準エラーをまとめて取得
4. ログを `logs/weekly_YYYY-MM-DD_HHmmss.log` に保存（JST）。さらに最新の結果を `logs/last_run.txt`（成功/失敗・日時・追加曲数・未マッチ数）に上書き。**トークンの値は出力しない**
5. 終了コード: 成功 0 / どれかの段階が失敗 1 / `--max-add` 超過 2 / すでに実行中 3
6. 失敗の種類に応じた案内をログとコンソールに出す:
   - Spotify の refresh_token 失効（`invalid_grant` 等）→「`node scripts/auth_check.js` で再認証してください」
   - ネットワーク / NHK / Spotify の一時エラー → 「次回の実行で自動的に再試行されます（state は途中まで保存済み）」
7. 古いログは 60 日で削除（実行の最後に整理）
- テスト（子プロセス実行はモック/注入）: 成功時のログと last_run / 失敗時の終了コード / ロック（二重起動・古いロック）/ ログ整理 / 案内メッセージの選択

### 3. ワンクリック `scripts/sync_now.bat`
- ダブルクリックで、次を**対話式**で実行してウィンドウを閉じない（最後に `pause`）:
  1. `fetch` 2. `sync --dry-run`（追加予定を表示） 3. 続けて `sync`（`[y/N]` の確認あり）
- 文字化けしない（`chcp 65001`）。ファイルの位置からルートに移動し、パスのハードコードは禁止
- `scripts/weekly_sync.bat`: スケジューラ用。ルートに移動して `node scripts/weekly_sync.js` を実行し、終了コードをそのまま返す（`node` のパスは PATH 依存にせず、登録時に解決した絶対パスを使えるよう引数で受け取れる形に）

### 4. タスク登録 `scripts/register_weekly_task.ps1`（PowerShell 5.1 で動く）
- 既定: 毎週土曜 9:00、タスク名 `MusiclineSpotifySync`
- パラメータ: `-Day` `-Time` `-Remove`（解除）`-DesktopShortcut`（デスクトップに `sync_now.bat` へのショートカットを作成）
- 設定: **電源オフで時刻を逃した場合は起動後すぐ実行**（StartWhenAvailable）、ユーザーがログオン中に実行、バッテリー駆動でも実行、実行時間の上限は 1 時間
- `node` の絶対パスは `Get-Command node` で解決して登録する。見つからなければ分かりやすいエラー
- **スクリプトを実行すると PC の設定が変わるため、Kilo Code は、勝手に登録しない**（下の完了条件を参照）
- ファイル編集に `Get-Content` / `Set-Content` を使わない（文字化けの原因）。スクリプト自体は UTF-8 (BOM付き) で保存し、日本語メッセージが文字化けしないことを確認する

### 5. README の「運用」節（追記のみ）
- 週次の自動実行の仕組み、`sync_now.bat` の使い方、ログの場所、再認証の手順、タスクの登録・解除の方法を、短く書く

## 完了条件
1. `node --test` 全件通過（Red / Green ログ貼付）
2. 実機確認の順序（**各段階でユーザーの承認を得てから進む。勝手に進めない**）:
   1. `node scripts/weekly_sync.js` を 1 回実行（新着が無ければ追加 0 件の想定）。ログと `last_run.txt` の内容を表示
   2. `--max-add` の動作確認: `node src/index.js sync --max-add 0 --dry-run` の相当、または、モックでの確認結果を示す（本番の書き込みで超過を再現しない）
   3. `register_weekly_task.ps1` を実行して登録してよいか、ユーザーに確認（登録する日時・タスク名・実行内容を表示して止まる）
   4. 承認後に登録し、`Start-ScheduledTask` で 1 回だけ手動起動して、`last_run.txt` が更新されることを確認
   5. `-DesktopShortcut` でショートカットを作る場合も、作成前に確認する
3. トークン値がログ・`last_run.txt`・Work_Report に含まれないことを実値照合で確認
4. `logs/` と `data/weekly.lock` はコミットしない（`.gitignore`）
5. コミット → push → PR作成（`gh pr create --body-file`）→ CIグリーン確認。**マージはしない**
6. Work_Report: `workReport/2026-10-xx_task_5A_weekly_automation.md`。ユーザー操作待ちで止まる場合は、その旨と再開条件を明記し、勝手に「確認済み」と書かない
7. PowerShell 5.1 前提。コマンドを `&&` で連結しない
