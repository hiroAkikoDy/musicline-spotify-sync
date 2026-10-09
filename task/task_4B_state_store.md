# Task 4B: state.json（処理済み・月別プレイリストID）の管理

- ブランチ / Worktree: `feat/4b-state-store` / `../msync-wt-4b`（main から作成）
- セキュリティ分類: A（トークン等のシークレットは扱わない）
- 進め方: **red/green TDD**。テスト先行→Red確認→実装。テストを弱める変更は禁止
- 並列: Task 4A（`src/spotify/playlist.js`）と同時進行。ファイルは重ならない。通信なし
- 起点: `起点：計画/Phase4-4B/採用`

## 背景
Phase 4 では月別（放送月 JST, YYYY-MM）にプレイリストを1つ作り、曲を追記する。再実行しても二重追加しないよう、
処理済みの回・追加済みの曲・月別プレイリストIDを `data/state.json` に保存する（増分更新）。

## Task boundary
- 新規: `src/sync/state.js`, `test/sync/state.test.js`
- 触らない: `src/spotify/**`, `src/index.js`, `src/sync/plan.js` ほか既存ファイル, 依存追加（node標準のみ）
- `data/state.json` は `.gitignore` 済みか確認し、無ければ追加（これのみ `.gitignore` の変更を許可）

## スキーマ（version 1）
```json
{
  "version": 1,
  "updatedAt": "2026-10-10T00:00:00.000Z",
  "playlists": { "2026-09": { "id": "...", "name": "ミュージックライン 2026-09", "createdAt": "..." } },
  "tracks": { "<makeTrackKey>": { "uri": "spotify:track:...", "month": "2026-09", "episodeId": "...", "addedAt": "..." } },
  "episodes": { "<episodeId>": { "processedAt": "...", "matched": 3, "unmatched": 1 } },
  "unmatched": [ { "episodeId": "...", "airDate": "...", "title": "...", "artist": "..." } ]
}
```
- `tracks` のキーは既存の `makeTrackKey(title, artist)`（`src/nhk/normalize.js`）。import して使う

## 実装要件
1. `loadState(path = "data/state.json")`: 無ければ空の初期状態を返す。**壊れたJSON・未知の version は例外**にし、
   ファイルを上書きしない（データ消失防止）。メッセージにパスと対処（手動で確認）を含める
2. `saveState(state, path)`: 一時ファイル→rename の原子的書き込み。`updatedAt` を更新
3. 純粋な更新関数（入力を破壊せず新しい state を返す）:
   - `setPlaylist(state, month, { id, name })`, `getPlaylist(state, month)`
   - `recordTracks(state, entries)`: `entries = [{ key, uri, month, episodeId }]`。**既に key があれば上書きしない**（先勝ち）
   - `hasTrack(state, key)`
   - `markEpisode(state, episodeId, { matched, unmatched })`, `isEpisodeProcessed(state, episodeId)`
   - `recordUnmatched(state, items)`: 同一 `episodeId+title+artist` は重複して積まない
4. `month` は `YYYY-MM` 形式のみ許可（不正は例外）

## テスト（先に書く）
- load: ファイル無し=初期状態 / 正常 / 壊れたJSON=例外かつファイル不変 / 未知version=例外
- save→load の往復、原子的書き込み（一時ファイルが残らない）
- 各更新関数が入力 state を変更しない（イミュータブル）
- recordTracks の先勝ち、recordUnmatched の重複排除
- 月形式のバリデーション

## 完了条件
- `node --test` 全件通過（Red / Green ログ貼付）
- コミット → push → PR作成（`gh pr create --body-file`）→ CIグリーン確認。**マージはしない**
- Work_Report: `workReport/2026-10-xx_task_4B_state_store.md`、「動作確認結果」に未実施を残さない
- ターミナルは PowerShell 5.1。`&&` で連結しない
