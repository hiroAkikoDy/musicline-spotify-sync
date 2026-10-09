# Task 4A: Spotify プレイリスト API ラッパ（モックのみ・実機書き込みなし）

- ブランチ / Worktree: `feat/4a-playlist-api` / `../msync-wt-4a`（main から作成）
- セキュリティ分類: B
- 進め方: **red/green TDD**。テスト先行→Red確認（失敗出力をWork_Reportに貼る）→実装。テストを弱める変更は禁止
- 並列: Task 4B（`src/sync/state.js`）と同時進行。ファイルは重ならない
- **このTaskでは Spotify への実際の書き込みを行わない**（実機での作成・追加は Task 4C で、ユーザー確認のうえ行う）
- 起点: `起点：判例/3C-採点ルール変更/却下`（ユーザーが 2026-10-10 に「採点ルールは変更しない」と決定。同じ理由での再提案は新証拠なしに行わない）

## 事前調査（実装前に必須・Work_Report冒頭に記録）
公式ドキュメントを確認し、URL・要点・実装に影響する差異を記録する:
1. February 2026 migration guide のプレイリスト関連の変更（`/playlists/{id}/tracks` → `/items` は既知）
2. **プレイリスト作成のエンドポイント**: `POST /users/{user_id}/playlists` か `POST /me/playlists` か（Feb 2026 で変更されている可能性）、リクエストボディ（`name`, `description`, `public`）、レスポンス（`id`, `uri`, `snapshot_id`）
3. **アイテム追加**: `POST /playlists/{id}/items` のボディ（`uris`）、1回あたりの上限（既知は100）
4. **アイテム取得**: `GET /playlists/{id}/items` の `limit` 上限とページング（`next` / `offset`）。レスポンスのアイテム構造（`items[].item.uri` か `items[].track.uri` か。Feb 2026 での改名に注意）
5. Dev Mode の制約でプレイリスト操作に影響するもの
6. 前提と食い違う場合は**実装を止めて報告**（黙って辻褄を合わせない）

## Task boundary
- 新規: `src/spotify/playlist.js`, `test/spotify/playlist.test.js`
- 触らない: `src/spotify/client.js` ほか既存ファイル（`createSpotifyClient` が返す `spotifyFetch` を引数で受け取って使う）, `src/sync/**`, `src/index.js`, 依存追加

## 実装要件
すべて `spotifyFetch`（`(path, {method, headers, body}) => 解析済みJSON`）を第1引数で受け取る。

1. `createPlaylist(spotifyFetch, { name, description = "", isPublic = false })` → `{ id, name, uri }`
   - **既定は非公開**（`public: false`）
2. `listPlaylistUris(spotifyFetch, playlistId)` → `string[]`（そのプレイリストの全曲の `spotify:track:...`）
   - ページングを最後まで辿る。ローカルトラック等 `uri` が無い・`null` のアイテムは無視して落ちない
3. `addTrackUris(spotifyFetch, playlistId, uris, { chunkSize = 100 })` → `{ added: number, chunks: number }`
   - 100件ずつに分割して POST。空配列なら API を呼ばない
   - **渡された `uris` 内の重複は除いてから**追加（先勝ち）
   - 429 は `spotifyFetch` が処理する。ここでは再実装しない
   - 途中のチャンクで失敗したら例外を投げるが、**例外オブジェクトに「何件まで追加済みか」を持たせる**（呼び出し側が状態を保存できるように）
4. `ensureNotAlreadyAdded(existingUris, candidateUris)` → 追加すべき URI だけ返す純粋関数（既存と重複するものを除く）

## テスト（先に書く・通信はモック）
- createPlaylist: リクエストのパス・メソッド・ボディ、既定が非公開、公開指定
- listPlaylistUris: 複数ページ、`null` / uri無しアイテム、0件
- addTrackUris: 0件で呼ばない / 100件ちょうど=1チャンク / 101件=2チャンク / 250件=3チャンク / 入力内重複の除去 / 2チャンク目で失敗したときの「追加済み件数」
- ensureNotAlreadyAdded: 完全重複・部分重複・順序保持

## 完了条件
- `node --test` 全件通過（Red / Green ログ貼付）
- 「Spotify への書き込み系リクエストを実機で発行していない」ことを Work_Report に明記
- コミット → push → PR作成（`gh pr create --body-file`）→ CIグリーン確認。**マージはしない**
- Work_Report: `workReport/2026-10-xx_task_4A_playlist_api.md`、セキュリティ分類B、「動作確認結果」に未実施を残さない
- ターミナルは PowerShell 5.1。`&&` で連結しない
