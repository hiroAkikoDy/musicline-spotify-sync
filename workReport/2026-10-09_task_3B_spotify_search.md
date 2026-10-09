<!-- precedent_id: (ingest側で付与)
     source_type: experience
     report_schema: v2
     project: musicline-spotify-sync
     tags: spotify,search,tdd,node,phase3 -->
### 完了報告：Task 3B: Spotify 検索ラッパ
実施日時：2026-10-09（JST）
目標：NHK の曲情報から Spotify を検索するラッパ（buildQuery / searchTracks / searchWithFallback）と確認用CLI（scripts/search_check.js）を red/green TDD で実装し、PR作成・CIグリーンまで確認する（マージはしない）。

## 事前調査（公式ドキュメントの裏取り）
| ドキュメント | URL | 実装に影響する要点 |
|---|---|---|
| Search for Item | https://developer.spotify.com/documentation/web-api/reference/search | `limit`: **デフォルト5・範囲0–10**（前提どおり）。`q` のフィールドフィルタは `track` / `artist` が track検索で使用可（公式例: `q=remaster track:Doxy artist:Miles Davis`）。`market` は ISO 3166-1 alpha-2（`JP` 可。ユーザートークン時はユーザー国が優先される点に注意）。レスポンスは `tracks.items[]` 各TrackObjectに `id` / `uri` / `name` / `artists[].name` / `duration_ms`（前提どおり） |
| February 2026 migration guide | https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide | 検索への影響は **`limit` 上限 50→10・デフォルト 20→5**。10件超は `offset` でページングが必要。Searchエンドポイント自体は廃止対象外。`available_markets` / `popularity` / `linked_from` 等のフィールド削除（Track）→ 欠損フィールドを無害に扱う設計が必須 |

**結論: 前提（最大10・デフォルト5）とドキュメントは一致。矛盾点はなく実装を継続した。**

## 変更ファイル一覧
| ファイル | 変更内容 | 行番号 |
|---|---|---|
| src/spotify/search.js（新規） | `buildQuery`（NFKC正規化・`track:"..." artist:"..."` 組み立て・`"` エスケープ・複数アーティストは先頭1名）、`searchTracks`（URLSearchParamsでエンコード、limit丸め定数 `MAX_SEARCH_LIMIT=10`、欠損耐性、Candidate変換）、`searchWithFallback`（0件のときだけ artist 抜きで再検索） | 1–76（全体・76行） |
| test/spotify/search.test.js（新規） | buildQuery 6件 / searchTracks 8件 / searchWithFallback 4件、計18件。spotifyFetchはモック（実Spotifyに通信しない） | 1–202（全体・202行） |
| scripts/search_check.js（新規） | 引数の曲名・アーティストで検索し候補を表示するCLI。`.env` 自前パース（auth_check.js と同一方式・内容表示なし）、`getValidToken` / `forceRefresh` / `DEFAULT_TOKEN_PATH` を使用。トークン・display_name は表示しない | 1–81（全体・81行） |

## 発生したエラーと対処
| # | エラー内容 | 原因 | 対処法 |
|---|---|---|---|
| 1 | `gh pr create --body` が `unknown flag: --test\`` で失敗 | PowerShell 5.1 の here-string 渡しが壊れ、本文がワード分割された | 本文を一時ファイル（pr_body.md）に書き出し `--body-file` で作成し直した |
| 2 | `Out-File` で `パス ... の一部が見つかりませんでした` | 一時ディレクトリ `%TEMP%\kilo\t3b` が未作成だった | `New-Item -ItemType Directory -Force` で作成して再実行 |

（テストに関する失敗は「Red フェーズとして意図した失敗」のみ。実装後の予期しない失敗はなし）

## Git操作
- コミットメッセージ：feat: Spotify検索ラッパを追加 (buildQuery/searchTracks/searchWithFallback)
- コミットID：bbb8c5b（ブランチ feat/3b-spotify-search / 3 files changed, 359 insertions）
- ブランチ：feat/3b-spotify-search（main から作成済みのものを使用。新規ブランチ作成・merge なし）
- push状況：`git push -u origin feat/3b-spotify-search` 済み
- CIステータス：グリーン（push: run 37893160980 成功、pull_request: run 37893304580 成功・25s / job "test" 成功）

## 動作確認結果
**Red（実装前・未実装スタブに対して実行）:**
```
ℹ tests 80
ℹ pass 62
ℹ fail 18
✖ buildQuery ... 6件すべて失敗
✖ searchTracks ... 8件すべて失敗
✖ searchWithFallback ... 4件すべて失敗
```
assertion の actual/expected の例（未実装スタブに対する失敗）:
```
✖ 両方0件なら candidates=[]・usedFallback: true (1.9718ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

  + undefined
  - {
  -   candidates: [],
  -   query: 'track:"X"',
  -   usedFallback: true
  - }
```
（他の buildQuery 系テストも `actual: undefined, expected: 'track:"..."'` で同様に失敗）

**Green（実装後・worktreeルートで `node --test`、test/nhk + test/spotify 全体）:**
```
ℹ tests 80
ℹ suites 18
ℹ pass 80
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 10651.3528
```

**実機検索（2026-10-09 追記・ユーザーが再認証後に実施。3曲・実行間3秒）:**

トークン再認証後、`node scripts/search_check.js` を3件実行した結果。

[1] 日本語曲名（超最強 / 超ときめき♡宣伝部）:
```
検索語: track:"超最強" artist:"超ときめき♡宣伝部"
候補: 3件
- 超最強 / Cho Tokimeki Sendenbu [3:20] spotify:track:0bcZS6ifbiPHNFZNX71fiK (id: 0bcZS6ifbiPHNFZNX71fiK)
- 超最強 / Cho Tokimeki Sendenbu [3:21] spotify:track:3JhFppgZ0ed5RTm4xT5vJH (id: 3JhFppgZ0ed5RTm4xT5vJH)
- 超最強 - instrumental / Cho Tokimeki Sendenbu [3:19] spotify:track:1ePDpVhRA1gvOSFzPoR4Yl (id: 1ePDpVhRA1gvOSFzPoR4Yl)
```

[2] 全角英数を含む曲名（Ｓｕｐｅｒｍａｒｋｅｔ / ＳＥＫＡＩ　ＮＯ　ＯＷＡＲＩ）:
```
検索語: track:"Supermarket" artist:"SEKAI NO OWARI"
候補: 1件
- Supermarket / SEKAI NO OWARI [4:32] spotify:track:3TEu6rnvOBkZqKf0vQeVmy (id: 3TEu6rnvOBkZqKf0vQeVmy)
```
→ NFKC 正規化（全角→半角）が実クエリで機能し、完全一致の候補が取れた。

[3] 0件フォールバックの確認（超最強 / 存在しないアーティストXYZ0123）:
```
検索語: track:"超最強" (アーティスト付きは0件のため artist 抜きで再検索)
候補: 9件
- 超最強 / Cho Tokimeki Sendenbu [3:20] ... (id: 0bcZS6ifbiPHNFZNX71fiK) ほか8件
```
→ artist 付き検索が0件のとき、artist 抜きで自動再検索され `usedFallback` 動作を確認。

**`track:"..." artist:"..."` クォート付き構文の実機確認**: 上記3件すべてで期待どおりに動作した
（日本語・全角英数・絵文字(♡)含みでも0件や誤ヒットなく機能）。

**トークン非出力の照合（実トークン値との文字列照合）:**
```
access_token (実値) : 実行出力3件=含まれない / Work_Report=含まれない
refresh_token (実値): 実行出力3件=含まれない / Work_Report=含まれない
client_id           : Work_Report=含まれない
```

**実機検索からの重要な観察（3Cへの申し送り）:**
Spotify はアーティスト名を**ローマ字表記で返す場合がある**（例: NHK「超ときめき♡宣伝部」に対し
Spotify は「Cho Tokimeki Sendenbu」）。一方「SEKAI NO OWARI」は表記が一致した。3A のアーティスト
スコアリング（完全一致40/部分一致20）は正規化後の文字列比較のため、ローマ字化されたケースでは
アーティスト点が付かない可能性がある。曲名（と再生時間）主体の採用判断になるケースが増えるため、
3C の閾値設計・マッチ率検証で考慮すること。

## 完了条件チェック
- [x] `node --test` 全件通過（80/80・Red/Green ログ上記貼付）
- [x] 実機: `node scripts/search_check.js` を3曲で実行（2026-10-09追記・日本語1つ/全角英数1つ/0件フォールバック1つ・実行間3秒・クォート付き構文の実機動作を確認）
- [x] トークンが出力・Work_Reportに含まれないことを確認（実トークン値との文字列照合で確認・結果上記）
- [x] コミット → push → PR作成 → CIグリーン確認。マージはしない
- [x] Work_Report: `workReport/2026-10-09_task_3B_spotify_search.md`、起点: `起点：計画/Phase3-3B/採用`

## 車検結果（受け入れ基準と照合）
├── CIグリーン：○（run 37893304580 / 37893160980 とも success）
├── node --test：全80件通過 ○
├── セキュリティ（分類B）：○（トークン非出力・ unauthorized 送信なし）
├── 型アノテーション：○（JavaScript/JSDoc対象外。純JS・全引数をランタイムで検証）
└── テストを弱める変更なし：○（assert削除・skip追加・閾値緩和なし。既存テストは未変更）

## セキュリティ確認
├── トークンの標準出力・ログ出力：なし（search_check.js は候補のみ表示。例外メッセージも本文先頭300字のみで client.js 側にトークンは含まれない設計を踏襲）
├── 外部APIへの意図した送信：あり（api.spotify.com /v1/search のみ・想定内。ユニットテストは通信なし）
├── ハードコードされたシークレット：なし
└── 入力値のバリデーション：実装済み（normalizeText による非文字列→空文字、limit の [1,10] 丸め、応答欠損フィールドの型検査）

## 学習ポイント・次のステップへの展望
- Feb 2026 以降、ユーザートークン利用時は `market` よりユーザーのアカウント国が優先される（ドキュメント明記）。日本アカウント運用のため実害はないが、market=JP が常に効く保証はない点は3Cのマッチング閾値設計で考慮の余地あり
- 検索 limit は10が上限のため、3Cでマージンを見て候補を増やしたい場合は offset ページングの追加を検討（今回は要件どおり1リクエスト）
- `searchWithFallback` の query は「最後に実行した検索語」（フォールバック時は artist 抜き）。3Cがログ出力する際はこの値を使うと原因追跡しやすい
- PowerShell 5.1 では複数行の gh --body は here-string より `--body-file` が安全（再発防止）
- **実機検索で判明**: Spotify のアーティスト名はローマ字表記で返ることがある（超ときめき♡宣伝部 → Cho Tokimeki Sendenbu）。NHK側の日本語表記と一致しないケースでは3Aのアーティスト配点が付かないため、3Cは曲名+再生時間中心の採用ロジックとマッチ率検証で確認すること

## 起点
起点：計画/Phase3-3B/採用

## Claudeへの質問・相談事項
1. ~~実機確認~~ → **実施済み**（2026-10-09追記・上記「動作確認結果」参照）
2. `buildQuery` はフィールド値を必ずダブルクォートで囲む設計にしました（公式例はクォートなしだが、スペース含みタイトルとフィルタ混入の双方を防げるため）。実機3件で正常動作を確認済み。問題あれば要調整
