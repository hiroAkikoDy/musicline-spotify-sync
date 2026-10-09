# Task 3C: sync --dry-run の結合と実機マッチ率報告

- **着手条件**: 3A・3B が両方 main にマージ済みであること（`git pull` 後に `node --test` 全件通過を確認）
- ブランチ / Worktree: `feat/3c-sync-dry-run` / `../msync-wt-3c`
- セキュリティ分類: B（Spotifyの読み取りのみ。**書き込みAPIは一切呼ばない**）
- 進め方: red/green TDD

## 方針（確定事項）
- 対象は NHK が選曲を公開している回（2026-09-08 以降）。**プレイリスト月は放送月（JST, YYYY-MM）**
- この Task は **dry-run のみ**。プレイリスト作成・曲追加・`state.json` 書き込みは実装しない（Phase 4）

## Task boundary
- 変更: `src/index.js`（`sync` サブコマンドの追加。`fetch` は変更しない）
- 新規: `src/sync/plan.js`（対象選定・月グルーピング）, `src/sync/runMatch.js`（検索→採点→結果集計）, `src/sync/report.js`（表示・CSV出力）, `test/sync/*.test.js`
- 触らない: `src/nhk/**`, `src/spotify/**`, `src/match/**`（バグを見つけたら直さず Work_Report に記載して報告）, 依存追加

## 実装要件
1. CLI: `node src/index.js sync [--dry-run] [--since YYYY-MM-DD] [--limit N] [--include-theme]`
   - この Task では `--dry-run` **なしで実行されたらエラー終了**（「書き込みは未実装・Phase 4」と表示）
   - `--since`: 放送日（JST）以降の回のみ。`--limit N`: **新しい順に N 回**（曲を持つ回のみカウント）
   - `data/episodes.json` が無ければ `fetch` を先に実行するよう案内して終了
2. `plan.js`: `buildPlan(episodesCache, { since, limit, includeTheme })`
   - 曲を持つ回のみ（`extractTracks` が空でない）。未来日・musicList空は除外
   - テーマ曲除外 → 重複排除（回をまたいで1回だけ）→ **放送月（JST）ごとにグルーピング**（`{ "2026-09": Track[] , ... }`）
   - 重複は**最初に出現した月**に属させる。除外件数（テーマ曲・重複）を集計
3. `runMatch.js`: 各曲について
   - `searchTracks(title+artist)` → `pickBest`。ベストが null（低スコア）または候補0件なら `searchTracks(title のみ)` で再検索し再度 `pickBest`
   - リクエスト間は **500ms 以上**（検索は曲数ぶん発生するため）
   - 結果: `matched`（曲・採用候補・スコア・フォールバック有無）/ `unmatched`（曲・最高スコア候補・理由）
   - 1曲の失敗（例外）で全体を止めない。エラーとして記録して続行
4. `report.js`:
   - 標準出力: 月別の対象曲数、除外件数、**マッチ率（matched / 検索対象）**、フォールバックでマッチした件数
   - `out/unmatched.csv`（`episodeId,airDate,title,artist,bestCandidate,bestScore,reason`）、`out/matched_preview.csv`（目視確認用: NHKの曲名/アーティスト ↔ Spotifyの曲名/アーティスト、スコア）
   - CSVはエスケープ正しく（カンマ・引用符・改行）、Excelで開けるようBOM付きUTF-8
5. 閾値 `--min-score N`（既定は3Aの `MIN_SCORE_DEFAULT`）を追加し、報告で調整比較できるようにする
6. **リスク分析用の集計（Task 3B の実機で判明した事項への対応）**
   - 判明事項: Spotify はアーティスト名をローマ字で返すことがある（NHK「超ときめき♡宣伝部」→ Spotify「Cho Tokimeki Sendenbu」）。
     この場合、3Aのアーティスト配点が0になり、曲名完全一致50 + 再生時間10 = ちょうど60点（閾値ぎりぎり）でしか採用されない
   - また「曲名が部分一致(25) + アーティスト完全一致(40) = 65点」は別曲の誤採用になりうる
   - `matched_preview.csv` と標準出力に次の列/集計を追加する（**ロジックは変更しない。計測のみ**）:
     - 採用理由の内訳: 曲名(exact/core/partial) × アーティスト(exact/partial/none) × 再生時間(±5秒内/外/不明) の件数表
     - 「アーティスト点0で採用された件数」と、その一覧（NHK表記 ↔ Spotify表記）
     - 「曲名が部分一致(partial)で採用された件数」と、その一覧
     - 閾値 50 / 60 / 70 での matched 件数と、閾値ごとに結果が変わった曲の一覧
   - 上記を踏まえた**採点ルールの変更案は報告に書くだけ**にする。`src/match/**` は変更しない（判断はユーザーが行い、必要なら別タスク）

## テスト（先に書く・通信はモック）
- plan: since / limit / 未来日除外 / テーマ曲除外と `--include-theme` / 重複排除と月帰属 / 月境界（JST 0時またぎ。UTC表記だと月がずれる日時を含める）
- runMatch: ベスト採用 / title+artist 失敗→title のみで救済 / 全滅で unmatched / 例外でも続行
- report: CSVエスケープ、マッチ率計算、0件の割り算
- CLI: `--dry-run` なしでエラー、episodes.json なしの案内

## 完了条件
- `node --test` 全件通過
- 実機: `node src/index.js fetch` で最新化 → `node src/index.js sync --dry-run --limit 20`
  - **マッチ率、月別件数、unmatched の全件一覧（CSVの内容）、matched_preview の目視で怪しい例を5件**を Work_Report に記載
  - 閾値を変えた比較（例: 50 / 60 / 70）の表を付ける
  - Spotifyへの書き込み系リクエストが発行されていないことをコードの grep 結果で示す（`POST|PUT|DELETE` が `src/sync` に無い）
- コミット → push → PR → CIグリーン。**マージはしない**
- Work_Report: `workReport/2026-10-xx_task_3C_sync_dry_run.md`、起点: `起点：計画/Phase3-3C/採用`
- **採否の判断（マッチ率が許容できるか、閾値をどうするか）はユーザーが行う**。報告のみ
