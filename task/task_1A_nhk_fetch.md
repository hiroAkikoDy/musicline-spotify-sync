# Task 1A: NHK fetch・正規化・duration変換（Phase 1）

- ブランチ / Worktree: `feat/1a-nhk-fetch` / `../msync-wt-1a`
- セキュリティ分類: A（公開データのみ。シークレットを扱わない）
- 進め方: **red/green TDD**。テストを先に書き、失敗を確認（Red）してから実装する。
  Red のログ（失敗出力）を Work_Report に貼ること。テストを弱める変更（assert削除・skip・閾値緩和）は禁止。

## 背景（確認済みの事実）
- 一覧API: `https://api.nhk.jp/r8/l/radioepisode/pl/series-rep-Z9WGYY3GP5.json?offset=0`
  - `{ result[最大10件], nextUrl, resultUrl, count }`。`nextUrl` を辿る。2026-10-08時点 count=1662。
- 曲: `episode.detailedRecentEvent.misc.musicList[] = { name, duration("PT4M54S"), byArtist:[{name}] }`
- 放送日: `episode.releasedEvent.startDate`（ISO8601, +09:00）。`id`, `name`(ゲスト名)
- Phase 0 調査で判明:
  - `musicList` は「空配列」（未放送回）と「フィールド自体なし」（2020-01〜02頃の古い回）の2種類。**どちらもスキップ**
  - `result` は日付降順で、未来日の回を含む
  - `detailedComingEvent` は使わない
- 参考: `scripts/survey.js`（調査用。変更不要）

## Task boundary（このファイルだけ触る）
- 新規: `src/nhk/client.js`, `src/nhk/normalize.js`, `src/nhk/duration.js`, `src/index.js`（`fetch` サブコマンドのみ）, `test/nhk/*.test.js`
- 触らない: `src/spotify/**`, `.env`, `package.json` の dependencies（外部依存の追加禁止。テストは `node --test`）
- `src/index.js` は `fetch` のみ実装。他のコマンドは「未実装」と表示して終了コード1

## 実装要件
1. `src/nhk/duration.js`: `parseIsoDuration("PT4M54S") -> 294`（秒, 数値）。`PT1H2M3S`, `PT45S`, `PT3M` に対応。不正・空・undefined は `null`
2. `src/nhk/normalize.js`: `normalizeText(s)` = NFKC → 前後trim → 連続空白を1つに。`"ｔｏｍａｔｏ" -> "tomato"`。非文字列は空文字
   - `makeTrackKey(title, artist)` = 正規化後・小文字化した `title|artist`（重複排除キー。Phase 3以降で使用）
3. `src/nhk/client.js`:
   - `fetchAllEpisodes({ cachePath="data/episodes.json", sleepMs=1200, fetchImpl=fetch, logger })`
   - 全体を `nextUrl` で辿る。リクエスト間は **1秒以上 sleep**（デフォルト1200ms、1000未満を指定したらエラー）
   - **キャッシュ**: 取得済みエピソードは `data/episodes.json`（`{ fetchedAt, count, episodes:{[id]:episode} }`）に保存。
     既に `musicList` が非空で保存済みの回は再取得（上書き）しない。**同じページを再取得しない**ため、
     増分実行では先頭から辿り、1ページ全10件がすべて「musicList非空でキャッシュ済み」になった時点で打ち切る
   - **例外**: `musicList` が空配列の回（未放送回）は、次回実行時に取得結果で更新する（放送後に埋まるため）
   - 想定外の形（musicListが配列でない、byArtistが無い、nameが無い等）でも落とさず、`logger.warn` を出して続行
   - HTTPエラーは最大3回リトライ（指数バックオフ、429は `Retry-After` 尊重）。それでも失敗なら例外
   - 書き込みは一時ファイル→rename で原子的に
4. `extractTracks(episode)`: 1エピソードから `[{ title, artist, durationSec, episodeId, airDate }]` を返す純粋関数。
   musicListが空/無い/不正なら `[]`。`artist` は `byArtist[].name` を `, ` 連結（なければ空文字）
5. CLI: `node src/index.js fetch` で全取得。終了時に「総数・曲ありの回数・空の回数・フィールドなしの回数・総曲数」を表示

## テスト（先に書く）
- duration: 正常系3種、`PT0S`, 不正文字列, null
- normalize: 全角英数→半角、全角スペース、連続空白、非文字列
- extractTracks: 正常 / 空配列 / フィールドなし / byArtist欠損 / musicListが配列でない
- client: `fetchImpl` をモックし、(a) ページング (b) sleep間隔 (c) キャッシュ済みページを再取得しない
  (d) 空musicListの回は再実行で更新される (e) 429のRetry-After (f) 想定外構造でwarnして続行
  - **実NHKへの通信はテストで行わない**（モック必須）

## 完了条件
- `node --test` 全件通過（ログを貼る）
- 手動: `node src/index.js fetch` を **1回だけ** 実機実行し、`data/episodes.json` ができ集計が出ること。
  続けてもう1回実行し、2回目の通信が先頭数ページで止まること（通信ログ/件数で示す）
- `data/episodes.json` は `.gitignore` に入っていること（入っていなければ追加）
- `python -c` 相当のエッジ確認として `node -e` で `normalizeText("ｔｏｍａｔｏ　ＮＥＷ")` と `parseIsoDuration("PT4M54S")` の結果を記録
- コミット → **push** → CIグリーン確認（CI未設定なら `.github/workflows/ci.yml` に `node --test` のみの最小構成を追加してよい）
- Work_Report を `workReport/` に作成。「起点」欄: `起点：計画/Phase1-1A/採用`。「動作確認結果」に未実施を残さない
