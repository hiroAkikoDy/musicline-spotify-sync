# Task 4C: sync の書き込み実装（初めて実プレイリストを変更する）

- **着手条件**: 4A・4B が両方 main にマージ済みで、`git pull` 後に `node --test` が全件通過すること
- ブランチ / Worktree: `feat/4c-sync-write` / `../msync-wt-4c`
- セキュリティ分類: B
- 進め方: red/green TDD
- 起点: `起点：計画/Phase4-4C/採用`

## 確定している決定事項（変更しない）
- 採点ルール（`src/match/**`）は**変更しない**。閾値は既定の 60。未マッチ曲は放置（`state.unmatched` と `out/unmatched.csv` に記録するだけ）
- プレイリストは放送月（JST, YYYY-MM）ごとに1つ。名前は `ミュージックライン YYYY-MM`、**非公開**
- 対象は 2026-09-08 以降の曲がある回。テーマ曲（NEW POINT / 西岡大貴）は既定で除外

## Task boundary
- 変更: `src/index.js`（`sync` の `--dry-run` なし経路を実装。`--dry-run` と `fetch` の挙動は変えない）
- 新規: `src/sync/apply.js`（書き込みの実行）, `test/sync/apply.test.js`
- 触らない: `src/nhk/**`, `src/match/**`, `src/spotify/**`, `src/sync/plan.js` `runMatch.js` `report.js` `state.js`（不具合を見つけたら直さず報告）, 依存追加

## 実装要件
1. CLI: `node src/index.js sync [--limit N] [--since YYYY-MM-DD] [--include-theme] [--min-score N] [--yes]`
   - `--dry-run` なし = 書き込みモード。**実行前に計画（月別の追加予定曲数・新規作成するプレイリスト名）を表示し、`[y/N]` で確認**。`--yes` で確認を省略
   - 確認は書き込み直前の1回だけ（マッチング自体は読み取りのみ）
2. `apply.js` の流れ（`plan` → 未処理のみ → `runMatch` → 月ごとに書き込み）:
   1. `loadState`。`isEpisodeProcessed` の回は対象から外す。`hasTrack(makeTrackKey)` の曲も検索しない（検索API節約）
   2. 検索・採点（既存の `runMatch`）。matched / unmatched を得る
   3. 月ごとに: `getPlaylist(state, month)` が無ければ `createPlaylist` して `setPlaylist` → **直後に `saveState`**
   4. 既存プレイリストの内容を `listPlaylistUris` で取得し、`ensureNotAlreadyAdded` で重複を除く（state が失われた場合の二重追加防止）
   5. `addTrackUris` → 成功した曲を `recordTracks` → `saveState`
   6. 回の全曲を処理し終えたら `markEpisode`。`recordUnmatched` で未マッチを記録 → `saveState`
   - 途中の例外では、**それまでに成功した分の state を保存してから**終了コード1で終了（再実行で続きから）
     - `addTrackUris` の例外の `added` は「重複除去後の先頭から何件追加済みか」を表す。どの曲が追加済みかを `added` から推測せず、
       **失敗後は `listPlaylistUris` で実際のプレイリスト内容を読み直して**、追加済みの曲だけを `recordTracks` する（真実はSpotify側）
   - 日本語を含むファイルの編集に PowerShell の `Get-Content` / `Set-Content` を使わない（文字化けの原因。4Bで発生）。編集はエディタ機能か node で行う
3. 月をまたぐ重複曲は、最初に出現した月にのみ追加（既存の `plan` の挙動と一致）
4. 終了時のサマリ: 新規作成したプレイリスト、追加曲数（月別）、スキップ（処理済み/追加済み）、未マッチ件数、エラー
5. 書き込み先は常に `state` が持つプレイリストID。**ユーザーの他のプレイリストを変更・削除するコードは書かない**（削除系APIは使わない）

## テスト（先に書く・通信は全てモック）
- 初回: プレイリスト作成→追加→state保存の順序
- 再実行（同じ入力）: 作成も追加も発生しない（冪等）
- state が空でプレイリストが既に曲を持つ場合: 重複追加されない
- 途中失敗（2チャンク目で例外）: それまでの state が保存され、再実行で残りだけ追加される
- 月が2つ: それぞれ別プレイリスト、月をまたぐ重複は1回だけ
- 確認プロンプト: `n` で書き込み系が一切呼ばれない / `--yes` で呼ばれる
- 削除系メソッド（DELETE）が一度も呼ばれない

## 完了条件
1. `node --test` 全件通過（Red / Green ログ貼付）
2. **実機の初回書き込みは、必ず次の順序で、ユーザーに確認を取りながら行う**（勝手に進めない）:
   1. `node src/index.js sync --dry-run --limit 3` の結果を表示して**一度止まり**、ユーザーに「実行してよいか」を確認する
   2. 承認後 `node src/index.js sync --limit 3` を実行（作成されるのは最大で2つのプレイリスト）
   3. Spotify アプリでの目視確認（曲が追加されている・非公開・名前が `ミュージックライン YYYY-MM`）をユーザーに依頼して、**止まる**
   4. 同じコマンドをもう一度実行し、追加が0件（冪等）であることを示す
   5. ユーザーの承認後に `--limit 20`、続けて全件（直近の公開分）を実行する
3. トークン値が出力・CSV・Work_Report・state.json に含まれないことを実値照合で確認
4. `data/state.json` の内容（曲のURIやIDを含む）の抜粋を Work_Report に載せる場合は、先頭数件のみ
5. コミット → push → PR作成（`gh pr create --body-file`）→ CIグリーン確認。**マージはしない**
6. Work_Report: `workReport/2026-10-xx_task_4C_sync_write.md`、「動作確認結果」に未実施を残さない（ユーザー操作待ちで止まった場合は、その旨と再開条件を明記）
