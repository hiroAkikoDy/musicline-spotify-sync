<!-- precedent_id: (ingest側で付与)
     source_type: experience
     report_schema: v2
     project: musicline-spotify-sync
     tags: matching,tdd,node,phase3 -->
### 完了報告：Task 3A: マッチングの純粋ロジック
実施日時：2026-10-09（JST）
目標：NHK の Track と Spotify の Candidate を結び付ける純粋ロジック（theme/dedupe/score/pickBest）を red/green TDD で実装し、全テスト通過・CIグリーン・PR作成まで行う（マージはユーザーが実施）

## 変更ファイル一覧
| ファイル | 変更内容 | 行番号 |
|---|---|---|
| src/match/theme.js | 新規。isThemeSong / filterThemeSongs(tracks, { includeTheme=false }) | 1-16 |
| src/match/dedupe.js | 新規。dedupeTracks — makeTrackKey 同一の重複を排除し { unique, duplicates } を返す | 1-17 |
| src/match/score.js | 新規。WEIGHTS 定数・scoreCandidate（曲名/コア曲名/アーティスト/再生時間の配点と detail 内訳） | 1-88 |
| src/match/pickBest.js | 新規。MIN_SCORE_DEFAULT=60 エクスポート・pickBest（閾値/同点は並び順優先/runnerUp） | 1-32 |
| test/match/theme.test.js | 新規。テスト7件（一致/大小文字/全角表記/曲名のみ/アーティストのみ/includeTheme false・true） | 1-37 |
| test/match/dedupe.test.js | 新規。テスト5件（全角半角・大小文字/アーティスト違い/順序保持/重複なし/空配列） | 1-40 |
| test/match/score.test.js | 新規。テスト15件（曲名完全/部分/コア/優先/全角括弧/不一致、アーティスト完全/部分/不一致/複数名、±5秒境界・null、合計2件） | 1-84 |
| test/match/pickBest.test.js | 新規。テスト9件（定数/最高スコア/閾値未満null/minScore調整/同点順序/runnerUp/0件/全角英数） | 1-64 |

## 発生したエラーと対処
| # | エラー内容 | 原因 | 対処法 |
|---|---|---|---|
| 1 | Red フェーズ: `ERR_MODULE_NOT_FOUND`（新規4テストファイルが全滅・既存62件はpass） | 実装モジュール未作成（テスト先行の正常なRed） | 実装4ファイルを作成して Green 化 |
| 2 | Green 1回目: `actual: 20, expected: 45` の assertion 失敗（score.test.js の合計テスト） | テスト設計時の私の配点計算ミス。"Tomato Soup" と "Tomato Juice" は互いに包含しないため曲名は 0 点が正しく、25点を期待した方が誤りだった | テストを「Tomato Soup」vs「Tomato」（真の部分一致 25点）に修正し、detail の title/artist 各配点も assert に追加（実装は変更せず・assert を減らさない修正） |

## Git操作
- コミットメッセージ：feat: マッチング純粋ロジック (theme/dedupe/score/pickBest) を red/green TDD で追加
- コミットID：532bf11
- ブランチ：feat/3a-matching（main から作成済みのものを使用・新規作成せず）
- push状況：push 済み（-u origin feat/3a-matching）
- CIステータス：グリーン（push 実行 run 37893192227 = success、pull_request 実行 run 37893246105 = success / job "test" 22s）。PR: https://github.com/hiroAkikoDy/musicline-spotify-sync/pull/3（マージは未実施・ユーザーが実施）

## 動作確認結果
Red（node --test、実装前・worktree ルート）:
```
ℹ tests 66
ℹ suites 15
ℹ pass 62
ℹ fail 4

test at test\match\dedupe.test.js:1:1
✖ test\match\dedupe.test.js (502.3571ms)  'test failed'
test at test\match\pickBest.test.js:1:1
✖ test\match\pickBest.test.js (596.3919ms)  'test failed'
test at test\match\score.test.js:1:1
✖ test\match\score.test.js (586.9529ms)  'test failed'
test at test\match\theme.test.js:1:1
✖ test\match\theme.test.js (604.327ms)  'test failed'

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...\msync-wt-3a\src\match\dedupe.js' imported from ...\test\match\dedupe.test.js
（pickBest.js / score.js / theme.js も同様の4件）
```
※ 新規モジュール不在が原因のため assertion の actual/expected は発生せず、ロードエラーが Red の根拠。

Green 1回目の失敗（対処 #2 の証跡・actual/expected 付き）:
```
code: 'ERR_ASSERTION',
actual: 20,
expected: 45,
operator: 'strictEqual',
```

Green（実装後・worktree ルートで node --test、既存 test/nhk・test/spotify 込み）:
```
ℹ tests 99
ℹ suites 23
ℹ pass 99
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 11303.9754
```

scoreCandidate の node 実行結果（temp: %TEMP%\kilo\t3a\score_demo.mjs）:
```
[1] track{ Imagine (Remastered 2010) / John Lennon / 185s } × candidate{ Imagine - Live / [John Lennon] / 190s }
    → score 90 = 曲名40(core) + アーティスト40(exact) + 時間10(diffSec:5)
[2] track{ ｔｏｍａｔｏ / 西岡大貴 / 200s } × candidate{ TOMATO / [西岡大貴] / 196s }
    → score 100 = 曲名50(exact・全角英数吸収) + アーティスト40(exact) + 時間10(diffSec:4)
[3] track{ Tomato Soup / YAMADA TARO / 180s } × candidate{ Tomato / [YAMADA TARO JR.] / 186s }
    → score 45 = 曲名25(partial) + アーティスト20(partial) + 時間0(diffSec:6)
    → pickBest では best: null（45 < MIN_SCORE_DEFAULT 60）、runnerUp: null
```

## 完了条件チェック
- [x] `node --test` 全件通過（99/99・Red / Green ログ貼付済み）
- [x] node 実行で `scoreCandidate` を3件実行した結果を記録
- [x] コミット → push → PR作成（gh pr create）→ CIグリーン確認
- [x] マージはしない（ユーザーが実施）
- [x] Work_Report 作成（本ファイル・起点: 起点：計画/Phase3-3A/採用）
- [x] 共通インターフェース厳守（Track / Candidate 変更なし）
- [x] normalizeText / makeTrackKey は src/nhk/normalize.js から import（コピー・改変なし）

## 車検結果（受け入れ基準と照合）
├── CIグリーン：○（run 37893192227 / 37893246105 とも success）
├── node --test：全99件通過 ○
├── セキュリティ（分類A）：○
├── 型アノテーション：○（JS プロジェクトのため JSDoc 相当の純粋関数・node --test で検証。例外: なし）
└── テストを弱める変更なし：○（対処 #2 は誤った期待値の修正であり、assert はむしろ追加・skip/閾値緩和なし）

## セキュリティ確認
├── 外部APIへの意図しない送信：なし（通信・fetch・fs 一切なしの純粋ロジック）
├── ハードコードされたシークレット：なし
└── 入力値のバリデーション：実装済み（非配列→[]、非文字列→normalizeText で空文字、非数値 duration→0 点、null/undefined 安全扱い）

## 学習ポイント・次のステップへの展望
- 「片方が他方を含む」部分一致は空文字を含む全文字列にマッチするため、norm 後の空文字ガードが必須だった
- score.js の配点は WEIGHTS 定数に集約済み。3C 結合時に閾値を調整する場合は MIN_SCORE_DEFAULT（pickBest.js）のみ変更すればよい
- detail の match 種別（exact/partial/core/none）を 3C のログ出力に使うと「なぜ不一致か」のデバッグが容易になる見込み
- CI の annotations に actions/checkout@v4 の Node.js 20 非推奨警告あり（本タスク境界外・既存ワークフローの将来課題）

## 起点
起点：計画/Phase3-3A/採用

## Claudeへの質問・相談事項
1. `filterThemeSongs(tracks, { includeTheme=true })` の解釈：タスク記載の名称から「テーマ曲を含めて返す（=除外しない）」と解釈して実装した（true なら全件返す）。もし「テーマ曲のみ返す」の意図であれば theme.js の分岐修正が必要なため確認を要する
2. コア曲名の「- 」以降の除去は「前後に空白を伴うハイフン（` - `）の最初の出現」を区切りとして実装した（例: "Imagine - Live" → "Imagine"）。ハイフン前後の空白がないケース（"-Live"）は区切らない仕様だが、この解釈でよいか確認を要する
3. scoreCandidate で閾値未満の場合でも pickBest は score/detail に最高スコア側の情報を返す設計にした（3C のデバッグログで活用可能）。runnerUp も閾値に関係なく2位の候補を返す。この戻り値仕様でよいか確認を要する
