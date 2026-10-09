# Task 3A: マッチングの純粋ロジック（通信なし）

- ブランチ / Worktree: `feat/3a-matching` / `../msync-wt-3a`（main から作成）
- セキュリティ分類: A
- 進め方: **red/green TDD**。テスト先行→Red確認（失敗出力をWork_Reportに貼る）→実装。テストを弱める変更は禁止
- 並列: Task 3B（`src/spotify/search.js`）と同時進行。**下の「共通インターフェース」を厳守**（3Cで結合する）

## 共通インターフェース（3A・3B・3C 共通・変更禁止）
```js
// NHK側の曲（extractTracks の出力・既存）
Track     = { title, artist, durationSec|null, episodeId, airDate }
// Spotify側の候補（3Bが返す形）
Candidate = { id, uri, title, artists: string[], durationSec|null }
```

## Task boundary
- 新規: `src/match/theme.js`, `src/match/dedupe.js`, `src/match/score.js`, `src/match/pickBest.js`, `test/match/*.test.js`
- 触らない: `src/nhk/**`, `src/spotify/**`, `src/index.js`, 依存追加（node標準のみ）
- 既存の `normalizeText` / `makeTrackKey`（`src/nhk/normalize.js`）は**import して使う**。コピー・改変しない

## 実装要件
1. `theme.js`: `isThemeSong(track)` — 正規化後に曲名が `NEW POINT`（大文字小文字無視）かつアーティストに `西岡大貴` を含む場合 true。
   `filterThemeSongs(tracks, { includeTheme=false })`
2. `dedupe.js`: `dedupeTracks(tracks)` — `makeTrackKey` が同一のものは**最初の1件だけ**残す（順序保持）。除外した件数も返す
   `{ unique: Track[], duplicates: number }`
3. `score.js`: `scoreCandidate(track, candidate)` → `{ score, detail }`（detailは内訳。報告・デバッグ用）
   すべて `normalizeText` + 小文字化した上で比較。配点（定数として1箇所に定義）:
   - 曲名: 完全一致 +50 / 片方がもう片方を含む +25 / それ以外 0
   - アーティスト: 候補の `artists` のいずれかが track.artist（`, ` 区切りの各名も対象）と完全一致 +40 / 部分一致 +20 / 0
   - 再生時間: 両方 non-null で差が **±5秒以内** +10 / それ以外・null は 0
   - 括弧内（`(Remastered)`, `- Live` 等）の差で曲名一致を落とさないよう、比較用に括弧と `- ` 以降を除いた「コア曲名」でも一致判定し、コア一致なら +40
     （完全一致 +50 が優先。両方当てはまる場合は高い方のみ加点）
4. `pickBest.js`: `pickBest(track, candidates, { minScore=60 })` → `{ best: Candidate|null, score, detail, runnerUp }`
   - 最高スコアが `minScore` 未満なら `best: null`
   - 同点は候補の並び順（Spotifyの関連度順）で先を優先
   - `MIN_SCORE_DEFAULT = 60` をエクスポート（3Cで調整可能にする）

## テスト（先に書く）
- theme: 一致 / 曲名だけ一致でアーティスト違い / 全角表記（`ＮＥＷ　ＰＯＩＮＴ`）/ includeTheme=true
- dedupe: 全角半角・大文字小文字違いの同一曲、順序保持、重複件数
- score: 曲名完全/部分/コア一致、アーティスト完全/部分/不一致、±5秒境界（5秒ちょうどは加点、6秒は0）、duration null、複数アーティスト
- pickBest: 閾値未満で null、同点の順序、候補0件、runnerUp
- 全角英数混在（`ｔｏｍａｔｏ`）を含むケース最低1つ

## 完了条件
- `node --test` 全件通過（Red / Green ログ貼付）
- `node -e` で `scoreCandidate` を2〜3件実行した結果を記録
- コミット → push → PR作成（`gh pr create`）→ CIグリーン確認。**マージはしない**（ユーザーが行う）
- Work_Report: `workReport/2026-10-xx_task_3A_matching_logic.md`、起点: `起点：計画/Phase3-3A/採用`
