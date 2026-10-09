# Task 3B: Spotify 検索ラッパ

- ブランチ / Worktree: `feat/3b-spotify-search` / `../msync-wt-3b`（main から作成）
- セキュリティ分類: B（認証済みAPIを呼ぶ。トークンをログに出さない）
- 進め方: **red/green TDD**。テスト先行→Red確認→実装。テストを弱める変更は禁止
- 並列: Task 3A（`src/match/**`）と同時進行。**共通インターフェースを厳守**

## 共通インターフェース（変更禁止）
```js
Candidate = { id, uri, title, artists: string[], durationSec|null }
```

## 事前調査（実装前に必須・Work_Report冒頭に記録）
公式ドキュメントで次を確認する: Search for Item のリクエスト/レスポンス、February 2026 migration guide の検索への影響。
- 現行の `limit` の上限とデフォルト（前提: 最大10・デフォルト5）
- `type=track` のレスポンス形（`tracks.items[]` の `id`, `uri`, `name`, `artists[].name`, `duration_ms`）
- フィールドクエリ構文（`track:` / `artist:`）が使えるか、`market` パラメータ（`JP`）の扱い
- 前提と食い違う場合は**実装を止めて報告**（黙って辻褄を合わせない）

## Task boundary
- 新規: `src/spotify/search.js`, `test/spotify/search.test.js`, `scripts/search_check.js`
- 触らない: `src/spotify/client.js` ほか既存ファイル（`createSpotifyClient` は import して使うだけ）, `src/match/**`, `src/index.js`, 依存追加

## 実装要件
1. `buildQuery({ title, artist })`: 入力は **`normalizeText`（`src/nhk/normalize.js`）で NFKC 正規化済みにして**から組み立てる。
   - `artist` あり: `track:<title> artist:<artist>`（ドキュメントで構文を確認。クォートの扱いと、タイトル内の `"` のエスケープ）
   - `artist` が空/省略: `track:<title>` のみ
   - 複数アーティスト（`, ` 区切り）は**先頭の1名**で検索（全員を並べるとヒットしにくいため）
2. `searchTracks(spotifyFetch, { title, artist }, { limit=10, market="JP" })` → `Candidate[]`
   - `GET /search?q=...&type=track&limit=...&market=...`（`URLSearchParams` で正しくエンコード）
   - `limit` が上限を超える指定は上限に丸める（上限は定数1箇所）
   - 応答の欠損（`artists` 無し、`duration_ms` 無し等）で落ちない。`durationSec = Math.round(duration_ms/1000)`、無ければ null
   - 0件は `[]`
3. `searchWithFallback(spotifyFetch, track, opts)` → `{ candidates, usedFallback: boolean, query }`
   - 1回目: title+artist。**0件**なら artist 抜きで再検索（`usedFallback: true`）
   - ※「候補はあるが低スコア」の場合のフォールバック判断は3C側（スコア判定後に呼ぶ）。ここでは「0件のときだけ自動」
   - 候補評価は3Aの責務。ここでは行わない
4. `scripts/search_check.js`: 任意の曲名・アーティストを引数に1回検索し、`Candidate` を表示（トークンは出さない）。ユーザー操作不要（保存トークン使用）

## テスト（先に書く・実Spotifyへは通信しない）
- `buildQuery`: 通常 / artist空 / 全角英数（`ｔｏｍａｔｏ` → `tomato`）/ `"` を含むタイトル / 複数アーティストで先頭のみ
- `searchTracks`: `spotifyFetch` をモック。URLのクエリ内容（type, limit, market, エンコード）を検証 / 応答欠損 / 0件 / limit丸め
- `searchWithFallback`: 1回目ヒットで再検索しない / 0件で artist 抜き再検索 / 両方0件

## 完了条件
- `node --test` 全件通過（Red / Green ログ貼付）
- 実機: `node scripts/search_check.js` を **3曲以内**で実行（例: 日本語曲名1つ、全角英数を含むもの1つ）し、候補の構造を記録（リクエスト間1秒以上）
- トークンが出力・Work_Reportに含まれないことを確認
- コミット → push → PR作成 → CIグリーン確認。**マージはしない**
- Work_Report: `workReport/2026-10-xx_task_3B_spotify_search.md`、起点: `起点：計画/Phase3-3B/採用`
