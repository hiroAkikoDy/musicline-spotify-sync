<!-- precedent_id: (ingest側で付与)
     source_type: experience
     report_schema: v2
     project: musicline-spotify-sync
     tags: sync,dry-run,matching,rate-limit,phase3 -->
### 完了報告：Task 3C: sync --dry-run の結合と実機マッチ率報告
実施日時：2026-10-09（JST）
目標：NHK取得データと Spotify検索・採点を結合した `sync --dry-run` を実装し、直近20回の
マッチ率・unmatched・リスク分析（採用理由の内訳）を報告する。Spotifyへの書き込みは行わない。

## 事前確認（着手条件）
- 3A (PR #3)・3B (PR #4) とも main マージ済みを確認（worktree ベース `751f80e`）
- ベースライン: `node --test` **117/117 通過**（着手時に実行・全緑）

## 変更ファイル一覧
| ファイル | 変更内容 | 行番号 |
|---|---|---|
| src/index.js | `sync` サブコマンド追加（`--dry-run` `--since` `--limit` `--include-theme` `--min-score`）。dry-runなしは「未実装（Phase 4）」でエラー終了。`fetch` は無変更 | 21-46(parseSyncArgs), 48-104(runSync), 106-127(main) |
| src/sync/plan.js | 新規。`buildPlan`: 曲あり回のみ・未来日/since除外・新しい順limit・テーマ除外→重複排除(時系列最初の出現に帰属)→放送月(JST)グルーピング | 1-77 |
| src/sync/runMatch.js | 新規。`runMatch`: searchTracks→pickBest、ベストnull/候補0件でtitleのみ再検索、500ms間隔、1曲例外でも続行、attempts計測 | 1-88 |
| src/sync/report.js | 新規。`buildSummary`(マッチ率・内訳表・artist0一覧・partial一覧・閾値比較)/`buildReportText`/`writeReports`(BOM付きCSV・エスケープ対応) | 1-169 |
| test/sync/plan.test.js | 新規テスト8件（since/limit/未来日/テーマ/全角テーマ/重複と月帰属/JST月境界/集計） | 1-119 |
| test/sync/runMatch.test.js | 新規テスト8件（採用/救済/0件/閾値未満/低スコア救済/例外続行/sleep/attempts） | 1-138 |
| test/sync/report.test.js | 新規テスト8件（CSVエスケープ/BOM/マッチ率/0割り/内訳/一覧/閾値比較/ファイル出力） | 1-139 |
| test/sync/cli.test.js | 新規テスト3件（dry-runなしエラー/episodes.json案内/--since形式チェック。子プロセスで実CLIを検証） | 1-63 |

Task boundary順守: `src/nhk/**`, `src/spotify/**`, `src/match/**` は未変更（`git diff main..HEAD --stat` は
上記8ファイルのみ）。依存追加なし。`data/` と `out/` はコミットせず（.gitignore確認済み:
`data/*token*` / `data/episodes.json` / `out/`）。

## 発生したエラーと対処
| # | エラー内容 | 原因 | 対処法 |
|---|---|---|---|
| 1 | Red フェーズ: `ERR_MODULE_NOT_FOUND`（src/sync 4モジュール）+ CLIテスト3件失敗 | 実装前（テスト先行の正常なRed） | Green で実装し解消 |
| 2 | runMatchテスト全滅: 候補が空になり maxScore 0 | テストモックがレスポンスオブジェクトを返していた（spotifyFetch の契約は「解析済みJSON」）+ URLSearchParams の `:` が `%3A` にエンコードされモックのURL振り分けが不能 | モックを解析済みJSON返しに修正し、`decodeURIComponent(url)` でルーティング（**テスト側の契約ミスの修正。実装は変更せず**） |
| 3 | plan テスト: themeRemoved/duplicates/totalTracks の期待値が不一致 | テスト設計ミス: 重複ペアにテーマ曲を使ったため、テーマ除外（重複排除より先）で両方除去され重複カウントに到達しない | テーマ以外の重複ペア（ｔｏｍａｔｏ/Tomato）を追加して重複排除と月帰属を検証。テーマ除外後は duplicates=0 が正であることを確認し期待値を訂正（assert追加込み・弱めていない） |
| 4 | toCsv テスト: 期待値のタイポ（引用符が1組多い） | 手書きミス | 期待値を訂正 |
| 5 | 重複テスト: 残存タイトルの期待値が `ｔｏｍａｔｏ`（未正規化） | Track.title は extractTracks が NFKC 正規化済みで返す仕様（1A）を忘れていた | 正規化後の `tomato` を期待するよう訂正 |
| 6 | report テスト: 内訳/artistZero の期待値が fixture のタイポ(attemptのwithin誤り)と固有名(SP-exact)で不一致 | テストfixtureの設定ミス | fixture を訂正し、artistZero のアーティスト配列 `["SP-none"]` も検証に追加 |

いずれも**実装（src/sync, src/index.js）への妥協・テストの弱化はなし**（失敗は全てテスト側の
契約・期待値ミス。assert は最終的に 31件追加）。

## Git操作
- コミットメッセージ：feat(3C): sync --dry-run を追加 (plan/runMatch/report・実機マッチ率96.6%)
- コミットID：（下記参照）
- ブランチ：feat/3c-sync-dry-run（main から作成済みのものを使用）
- push状況：push 済み
- CIステータス：グリーン（PR実行）
- PR: （下記参照・マージは未実施）

## 動作確認結果
**Red（実装前）:**
```
✖ CLI: sync サブコマンド / ✖ plan.test.js / ✖ report.test.js / ✖ runMatch.test.js
ℹ tests 123 / pass 117 / fail 6
（CLI: stderr に --dry-run の案内が無く失敗。残り3ファイルは ERR_MODULE_NOT_FOUND）
```

**Green（実装後・worktreeルート）:**
```
ℹ tests 148
ℹ pass 148
ℹ fail 0
ℹ duration_ms 約14秒
```

**実機 fetch（最新化・増分）:**
```
[fetch] GET ...offset=0 → 10件 (保存/更新 7件, キャッシュ済みスキップ 3件)
[fetch] GET ...offset=10 → 10件 (保存/更新 0件, キャッシュ済みスキップ 10件)
[fetch] 2ページ目全体がキャッシュ済みのため取得を打ち切り
総数: 1663 / 曲ありの回数: 23 / 空の回数: 6 / フィールドなしの回数: 1634 / 総曲数: 91
```

**実機 sync --dry-run --limit 20（再実行で同一結果・再現性確認済み）:**
```
対象: 20回 / 58曲 (テーマ曲除外 20件, 重複除外 1件, minScore=60)
--- 月別 ---  2026-09: 40曲 / 2026-10: 18曲
検索対象: 58曲 / マッチ: 56曲 / 未マッチ: 2曲 / エラー: 0曲
マッチ率: 96.6%
フォールバックでマッチ: 1曲
採用理由の内訳:
  曲名=exact × アーティスト=exact × 時間=within: 37件
  曲名=exact × アーティスト=none   × 時間=within: 11件
  曲名=exact × アーティスト=partial× 時間=within: 7件
  曲名=exact × アーティスト=exact × 時間=outside: 1件
閾値比較: 50点以上 56件 / 60点以上 56件 / 70点以上 45件
```

**unmatched 全件一覧（out/unmatched.csv・2件）:**
| episodeId | airDate | title | artist | bestCandidate | bestScore | reason |
|---|---|---|---|---|---|---|
| 6MX7Z96J57 | 2026-09-11 | 心配無用節 -無添加- | クレイジーケンバンド | 心配無用節 - 無添加 / Crazy Ken Band | 10 | below_threshold |
| 8MGRM1YVJQ | 2026-10-08 | Call me tonigh | 高瀬統也, 思遠 AL | Call me tonight / TakaseToya, 思遠AL | 35 | below_threshold |
- 2件とも「正しい曲が候補にあるのに採用できない」ケース。
  ①は NHK表記「-無添加-」（ハイフン直後に空白なし）のためコア曲名ルールが効かず×アーティストがローマ字。
  ②は NHK側のタイポ（tonigh）×ローマ字アーティスト。

**matched_preview の目視で怪しい例（5件）:**
| # | NHK | Spotify | score | 怪しさの内容 |
|---|---|---|---|---|
| 1 | 超最強 / 超ときめき♡宣伝部 | 超最強 / Cho Tokimeki Sendenbu | 60 | アーティスト表記不一致(ローマ字)・**閾値ちょうど60点で採用**。曲は同一と目視確認 |
| 2 | OKIDOKI / クレイジーケンバンド | OKIDOKI / Crazy Ken Band | 60 | 同上。曲は同一 |
| 3 | すばらしい日々 / ユニコーン | すばらしい日々 / UNICORN | 60 | 同上。曲は同一 |
| 4 | You (feat. UMI) / Fujii Kaze | You (feat. UMI) / Fujii Kaze, UMI | 90 | 曲名・アーティスト完全一致だが**再生時間差65秒**（NHK側がフェード/トーク込みの可能性）。曲は同一と目視確認 |
| 5 | black rose / FictionJunction feat.EMIKO | black rose / FictionJunction, EMIKO | 80 | feat.表記の違いでアーティスト部分一致・**フォールバック経由で採用**。曲は同一と目視確認 |
※ 誤採用（別曲を採用している例）は **0件**。partial曲名での採用も 0件。

**リスク分析（要件6・計測のみ/ロジック変更なし）:**
- 採用56件の内訳: exact×exact×within 37 / exact×none×within 11 / exact×partial×within 7 / exact×exact×outside 1
- **アーティスト点0で採用: 11件（全員 ちょうど60点 = 曲名完全一致50+再生時間10）**。
  全てローマ字表記問題（クレイジーケンバンド→Crazy Ken Band 等）で、曲自体は目視で正しい。
  ただし閾値70にすると全滅する「ぎりぎり採用」群
- 曲名が部分一致で採用: **0件**（レビュー指摘の「partial25+artist40=65 別曲誤採用」は今回は発生せず）
- 閾値比較（同一検索結果からの再集計 + --min-score 70 の実機再実行で検証）:
  | 閾値 | matched | マッチ率 | 備考 |
  |---|---|---|---|
  | 50 | 56 | 96.6% | 60と同じ |
  | **60（既定）** | **56** | **96.6%** | artist-zero 11件を含む |
  | 70 | 45 | 77.6% | artist-zero 11件が全て落ちる（実機再実行 `--min-score 70` で 45件を確認・整合） |
  閾値で採否が変わる曲: 上記11件（全て60点ちょうど）

**Spotify書き込み系APIが無いことの証明（grep結果）:**
`Select-String -Path src\sync\*.js, src\index.js -Pattern "POST|PUT|DELETE"` → **一致 0件**。
（検索は GET のみ。プレイリスト作成・曲追加・state.json書き込みは未実装）

**トークン非出力の照合:** data/spotify_token.json の実値（access_token/refresh_token）および
client_id が、実行出力・out/*.csv・本レポートに含まれないことを文字列照合で確認（含まれない）。

## 完了条件チェック
- [x] `node --test` 全件通過（148/148・Red/Green ログ貼付）
- [x] 実機 fetch で最新化（増分2リクエスト）
- [x] 実機 `node src/index.js sync --dry-run --limit 20`（マッチ率96.6%・月別件数・unmatched全件・怪しい例5件）
- [x] 閾値比較（50/60/70 の表 + --min-score 70 の実機検証）
- [x] 要件6のリスク分析（内訳表・artist0 11件の一覧・partial 0件・閾値別比較）
- [x] 書き込み系リクエスト無しの grep 証跡
- [x] トークンが出力・CSV・レポートに含まれない（実値照合）
- [x] コミット → push → PR → CIグリーン（マージはしない）
- [x] Work_Report 作成（起点: 起点：計画/Phase3-3C/採用）

## 車検結果（受け入れ基準と照合）
├── CIグリーン：○（PR実行）
├── node --test：全148件通過 ○
├── セキュリティ（分類B）：○（読み取りAPIのみ・トークン非出力）
├── 型アノテーション：○
└── テストを弱める変更なし：○（失敗は全てテスト側の契約/期待値ミスの修正。assert 31件追加）

## セキュリティ確認（分類B）
├── トークンの標準出力・ログ出力：なし（実値照合で確認）
├── 外部APIへの意図した送信：あり（NHK一覧API・Spotify /v1/search の GET のみ。書き込み系は呼ばない）
├── ハードコードされたシークレット：なし
└── 入力値のバリデーション：実装済み（--since形式/--limit整数/--min-score数値・不明オプション拒否・
    未認証時の案内・episodes.json欠落時の案内）

## 採点ルールの変更案（報告のみ・実装はしない。判断はユーザー）
1. **コア曲名ルールの緩和**: 現在は「 - 」（前後空白あり）でしか後段を切り捨てないため、
   NHK「心配無用節 -無添加-」vs Spotify「心配無用節 - 無添加」が不一致になる（未マッチ1件の原因）。
   案: ハイフン前後の空白を任意（`/\s*-\s*/`）にする、または括弧と同様にハイフン区切り全体を
   トークン化して比較する。適用すれば未マッチ1件が救済される見込み
2. **ローマ字アーティスト対策**: artist=none でも「曲名完全一致 + 再生時間±5秒」は実際には
   全て正しい曲だった（11/11件）。案: 曲名完全一致+時間within を「高信頼」とみなし artist=none を
   減点しない（または+5点）。逆に artist 完全一致+曲名partial は別曲リスクがあるため現状維持
3. **NHKタイポ耐性**: 「Call me tonigh」のような NHK側タイポは部分一致(25)+時間(10)で35点止まり。
   案: 曲名のレーベンシュタイン距離や front-match（前方一致）を extra スコアにする
   （いずれも src/match/** への別タスクでの改修が前提。本タスクでは計測のみ）

## 学習ポイント・次のステップへの展望
- 3Bで予見した「ローマ字アーティスト」問題が実際に11件/56件（19.6%）発生。いずれも曲名完全一致+
  時間within で正しい曲だったため、実運用上の誤採用はゼロだった
- `attempts`（曲ごとの最高スコア計測）を持たせたことで、閾値比較を再検索なしで実施できた
  （APIリクエスト節約・1回の実行で 50/60/70 を比較可能）
- PowerShell 5.1 では gh pr create の本文は --body-file 推奨（1B/3Bと同様）
- Phase 4 に向け: 月別プレイリスト作成（2026-09: 40曲, 2026-10: 18曲）、state.json（処理済み回）、
  artist-none 採用の扱い（確認してから追加する二段構え等）が論点

## 起点
起点：計画/Phase3-3C/採用

## Claudeへの質問・相談事項
1. **採否の判断をお願いします**: マッチ率 96.6%（minScore=60）は許容範囲か。閾値は 60 のままでよいか
   （70 にするとローマ字アーティストの11件が全て未マッチになります）
2. 採点ルール変更案（上記3項目）を実施するかどうか。実施する場合は src/match/** への別タスクを提案します
3. NHK側データのタイポ（「Call me tonigh」）は元データの問題です。対処（手動マップ等）が必要かご検討ください
