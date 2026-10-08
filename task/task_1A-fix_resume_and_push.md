# Task 1A-fix: 再開バグ修正・テスト差分の開示・push/CI

- ブランチ / Worktree: 既存の `feat/1a-nhk-fetch` / `../msync-wt-1a`（新規ブランチは作らない）
- セキュリティ分類: A
- 進め方: red/green TDD。**修正テストを先に書き、失敗（Red）を確認してから実装**。テストを弱める変更は禁止。
- 前提: ユーザーが GitHub に private リポジトリを作成済みで、URL を渡される。渡されていなければ止まって確認する

## 背景（レビュー指摘）
1. `fetchAllEpisodes` の打ち切り判定が「ページ全件が既存の非空キャッシュ」だけのため、
   初回の全件取得が途中で中断すると、再実行時に2ページ目で打ち切られ、後半が永久に取得されない
   （Work_Report の「中断しても続きから再開できる」は誤り）
2. テスト(d-1)を実装後に書き換えた旨の申告があるが、コミットが1本で差分を確認できない
3. HTTP 404 など再試行しても無意味なエラーも3回リトライしている
4. push / CI 未実施（第4条）

## Task boundary
- 触る: `src/nhk/client.js`, `test/nhk/client.test.js`, `workReport/2026-10-08_task_1A_nhk_fetch.md`（追記のみ・既存記述は削除/改変しない）
- 触らない: 上記以外すべて

## 要件
1. **再開バグ修正**: キャッシュに `complete: true|false` を持たせる
   - 全ページを辿り切ったときだけ `complete: true`。保存はページごとの原子書き込みのまま、中断時は `false`
   - 増分打ち切りは **`complete === true` のときに限り**有効。`false` や欠落（旧形式）なら打ち切らず最後まで辿る
   - 旧形式のキャッシュ（`complete` なし）は `false` として扱う（再実行で補完される）
2. 回帰テスト（先に書く）: 「全件取得を途中で中断→再実行→全ページが取得される」「complete=true のときは先頭ページ群で止まる」
   「complete が無い旧キャッシュは打ち切らない」
3. **リトライ**: 5xx・429・ネットワークエラーのみ再試行。404 などの 4xx は即例外（テスト追加）
4. **(d-1) の差分開示**: `git log -p` / 旧版が取れなければ記憶ベースでよいので、旧版→新版の違いと「弱めていない」根拠を
   Work_Report に追記。Red の失敗出力（assertion の失敗内容）を貼る
5. **Work_Report 訂正**: 「中断しても再開できる」の記述は誤りだったので、**削除せず**「訂正」節を追記して
   修正内容を記録する（第3条）

## 完了条件
- `node --test` 全件通過（Red / Green 両方のログを貼る）
- 実機: `node src/index.js fetch` を1回実行して集計が従来と一致、続けてもう1回で先頭2ページ前後で停止
  （`complete:true` が保存されていること）。ネットワークを使うのはこの2回のみ
- コミット → `git remote add origin <URL>` → `feat/1a-nhk-fetch` と `main` を push → **GitHub Actions のグリーンを確認**
  （`gh run list` / `gh run view` の結果を貼る）
- `.kilo/` は push しない（`.gitignore` に追加してよい）
- Work_Report「起点」欄: `起点：バグ/1A-resume/採用`。「動作確認結果」に未実施を残さない
