<!-- precedent_id: (ingest側で付与)
     source_type: experience
     report_schema: v2
     project: musicline-spotify-sync
     tags: nhk-fetch,tdd,node,cache,phase1 -->
### 完了報告：Task 1A: NHK fetch・正規化・duration変換（Phase 1）
実施日時：2026-10-08（JST）
目標：NHKミュージックライン一覧APIの全ページ取得（sleep・リトライ・増分キャッシュ付き）、
NFKC正規化、ISO8601 duration変換を red/green TDD で実装し、`node --test` 全件通過・
実機fetch2回（増分で先頭数ページ停止）を確認する。

## 変更ファイル一覧
作業場所: worktree `../msync-wt-1a`（ブランチ `feat/1a-nhk-fetch`）

| ファイル | 変更内容 | 行番号 |
|---|---|---|
| src/nhk/duration.js | 新規。`parseIsoDuration`: ISO8601 duration→秒。不正/空/undefined→null | 1-12 |
| src/nhk/normalize.js | 新規。`normalizeText`(NFKC→trim→連続空白圧縮), `makeTrackKey`, `extractTracks` | 1-36 |
| src/nhk/client.js | 新規。`fetchAllEpisodes`: ページング/1.2s sleep/3回リトライ(指数バックオフ,429はRetry-After尊重)/キャッシュ増分/原子書き込み | 1-143 |
| src/index.js | 新規。`fetch` サブコマンド+集計表示。他コマンドは「未実装」でexit 1 | 1-22 |
| test/nhk/duration.test.js | 新規テスト（先に作成=Red） | 1-31 |
| test/nhk/normalize.test.js | 新規テスト（先に作成=Red） | 1-38 |
| test/nhk/extractTracks.test.js | 新規テスト（先に作成=Red） | 1-56 |
| test/nhk/client.test.js | 新規テスト（先に作成=Red）。fetchImpl/sleepImplモック。実NHK通信なし | 1-221 |
| .gitignore | `data/episodes.json` を追加 | 6行目 |
| .github/workflows/ci.yml | 新規。`node --test` のみの最小構成（完了条件の許可に基づく） | 1-13 |

Task boundary順守: `src/spotify/**`, `.env`, `package.json` dependencies は未触（外部依存の追加なし）。

## 発生したエラーと対処
| # | エラー内容 | 原因 | 対処法 |
|---|---|---|---|
| 1 | Redフェーズ: `ERR_MODULE_NOT_FOUND`（全4テストファイル） | 実装前なのでモジュールが存在しない（TDDの期待どおりの失敗） | Greenフェーズで実装し解消 |
| 2 | Green後もテスト(a)(b)が失敗: 1ページ目で取得が打ち切られる | 打ち切り条件が「その時点でmusicList非空」判定だったため、**新規取得した回**も「キャッシュ済み」扱いになり、初回フル取得が1ページで止まるバグ | 実装を修正: `updated === 0`（=以前からキャッシュ済みの回だけで構成されるページ）のときのみ打ち切り。テスト(d-1)も修正後の仕様に合わせて再構成（弱める変更ではない：より厳密なシナリオに強化） |
| 3 | `node -e` で `Invalid string escape` / 引用符が消える | PowerShell 5.1のネイティブコマンド引数の引用符扱い | 一時スクリプトファイル（temp）に書いて `node file.mjs` で実行 |
| 4 | `git push` 失敗: `fatal: 'origin' does not appear to be a git repository` | **リモートが未設定**（git remote -v が空） | 対処不能（外部依存）。ユーザーにリモートURLを確認中。コミットは完了済み |

## Git操作
- コミットメッセージ：`feat(1A): NHK fetch・正規化・duration変換を実装 (red/green TDD, 28テスト)`
  （※ベースコミット `67f00b8` Phase 0雛形は、worktree/ブランチ作成に前提必要なため、
  既にステージ済みだった Phase 0 ファイルを main にコミットして作成）
- コミットID：304a828（feat/1a-nhk-fetch）
- ブランチ：feat/1a-nhk-fetch（worktree ../msync-wt-1a）
- push状況：**未完了** — リモート未設定のため（要ユーザー確認）
- CIステータス：**未実行** — pushできないため。ci.yml は追加済み（push後のグリーン確認が必要）

## 動作確認結果
**unit test（node --test、モックのみ・実NHK通信なし）:**
```
ℹ tests 28
ℹ suites 5
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1016.3
```
対象: duration 6件 / normalize+makeTrackKey 7件 / extractTracks 6件 / client 9件
（ページング・sleep間隔・キャッシュ済ページ再取得なし・空musicList更新・429 Retry-After・
想定外構造でwarn続行・sleepMs<1000エラー・500指数バックオフ・3リトライ後例外）

**実機 fetch 1回目（フル取得、1662回分）:**
```
[fetch] GET ...json?offset=0 → 10件 (保存/更新 10件, キャッシュ済みスキップ 0件)
（中略・全167リクエスト、リクエスト間1.2s sleep）
[fetch] GET ...json?offset=1660 → 2件 (保存/更新 2件, キャッシュ済みスキップ 0件)
--- 集計 (data/episodes.json) ---
総数: 1662
曲ありの回数: 22
空の回数: 6
フィールドなしの回数: 1634
総曲数: 87
```
`data/episodes.json` 生成を確認（`{ fetchedAt, count: 1662, episodes: {...} }` 形式）。

**実機 fetch 2回目（増分確認）— 2リクエストで打ち切り:**
```
[fetch] GET ...json?offset=0 → 10件 (保存/更新 6件, キャッシュ済みスキップ 4件)
[fetch] GET ...json?offset=10 → 10件 (保存/更新 0件, キャッシュ済みスキップ 10件)
[fetch] 2ページ目全体がキャッシュ済みのため取得を打ち切り
--- 集計（1回目と同一） ---
総数: 1662 / 曲あり 22 / 空 6 / フィールドなし 1634 / 総曲数 87
```
1ページ目の「空musicList（未放送回）6件」は仕様どおり再取得・更新され、
2ページ目（全10件がキャッシュ済み非空）で打ち切り → 「先頭数ページで止まる」を確認。

**エッジ確認（node -e 相当）:**
```
normalizeText("ｔｏｍａｔｏ　ＮＥＷ") = "tomato NEW"
parseIsoDuration("PT4M54S") = 294
makeTrackKey("ｔｏｍａｔｏ","ＳＥＫＡＩ　ＮＯ　ＯＷＡＲＩ") = tomato|sekai no owari
```

**CLI確認:** `node src/index.js sync` → `未実装: sync — 利用可能: fetch` でexitコード1。
引数なしも同様にexitコード1。

**.gitignore確認:** `git check-ignore -v data/episodes.json` → `.gitignore:6:data/episodes.json` ✓

## 完了条件チェック
- [x] `node --test` 全件通過（28/28、ログ上記）
- [x] 実機 fetch 1回実行 → data/episodes.json 生成・集計表示
- [x] 2回目実行 → 通信2リクエスト（先頭2ページ）で打ち切り
- [x] data/episodes.json を .gitignore に追加
- [x] node -e で normalizeText / parseIsoDuration の結果を記録
- [x] コミット完了
- [ ] **push → CIグリーン確認** — リモート未設定のため未完了（ユーザー確認事項）

## 車検結果（受け入れ基準と照合）
├── CIグリーン：✗（push不可のため未実行。ci.yml作成済み）
├── pytest：node --test 全28件通過 [○]
├── セキュリティ（分類A）：[○]
├── 型アノテーション：[○]（JSDoc的コメント付き。TypeScript不使用のプロジェクト方針どおり）
└── テストを弱める変更なし：[○]（assert削除・skip・閾値緩和なし。d-1はより厳密に強化）

## セキュリティ確認（分類A：公開データのみ）
├── 外部APIへの意図しない送信：なし（NHK公開APIへのGETのみ。認証情報・個人情報は送信しない）
├── ハードコードされたシークレット：なし（.envも読まない。Spotifyコードは未実装）
└── 入力値のバリデーション：実装済み（想定外構造でwarn続行、sleepMs<1000はエラー、
    JSONパース失敗時はキャッシュ新規作成）

## 重要な発見（次フェーズへの影響）
- **一覧APIのmusicListは直近約1ヶ月分（2026-09-08以降の28回分）にしか含まれない**。
  残り1634回（2020-01-20〜2026-09-07）は `detailedRecentEvent.misc` 自体が存在しない
  （Phase 0の「2020-01〜02頃の古い回のみ」という認識とは異なり、実態は全体の98%）。
  Phase 0 survey_raw.json（offset 1640〜1660が全てフィールドなし）と本取得結果が一致するため
  APIの仕様として確度が高い。
- → 過去アーカイブの選曲を取得するには単体取得API
  `https://api.nhk.jp/r8/t/radioepisode/re/{id}.json` の利用が必要になる可能性が高い。
  **Phase 3（マッチング）開始前に要調査・要相談**（Task 1Aの範囲は仕様どおりであり、
  本タスクでは対応しない）。
- キャッシュはページ単位で原子的に書き込むため、通信中断しても再実行で続きから再開できる。

## 学習ポイント・次のステップへの展望
- TDDの打ち切り条件バグ: 「新規取得」を「キャッシュ済み」と区別しないと、
  初回フル取得が1ページで止まる。テスト(a)(b)がこれを検出した（テストファーストの効能）。
- PowerShell 5.1 での `node -e` は引用符が剥がれるため、複雑な確認は一時スクリプトファイル推奨。
- Task 1B（Spotify認証）へ: `src/spotify/**` は未触。worktree並列は1本のみ（WIP制限2以内）。

## 起点
起点：計画/Phase1-1A/採用

## Claudeへの質問・相談事項
1. **リモートURLを教えてください**（GitHub等）。設定すれば push → CIグリーン確認まで即完了できます
   （現状: コミット 304a828 済み、push待ち）。
2. 過去回（1634回分）の選曲について、単体取得API (`/r8/t/radioepisode/re/{id}.json`) を
   試験的に叩いて構造を調査してよいか（Phase 3前の調査タスクとして）。
3. Work_Report はユーザー指定どおり main 側 `workReport/` に作成済み。
   ブランチ側へも含めるかどうか（現状: main側のみ・未コミット）。

---

# 【追記】Task 1A-fix: 再開バグ修正・テスト差分の開示・push/CI（2026-10-08）
起点：バグ/1A-resume/採用
（レビュー「条件付き差し戻し」への対応。task_1A-fix_resume_and_push.md に基づく。既存記述は削除/改変せず追記のみ）

## 訂正（レビュー指摘 #2 への対応）
旧記述「キャッシュはページ単位で原子的に書き込むため、通信中断しても再実行で続きから再開できる」は**誤り**でした（第3条どおり削除せず訂正として記録）。
旧実装の打ち切り条件は「ページ全件が既存の非空キャッシュ」のみのため、初回全件取得の途中で中断すると、
再実行時に最初の完全キャッシュ済みページで打ち切られ、後半が永久に取得されません。

**修正内容**（コミット bb893ea）:
- キャッシュに `complete: true|false` を持たせる。全ページを辿り切った（または増分打ち切りした）ときだけ `true`。
  ページごとの原子書き込みは維持し、途中で例外中断した場合は `complete: false` のまま残る
- 増分打ち切りは「前回完走（ロード時に `complete === true`）」のときに限り有効。
  `false`・欠落（旧形式キャッシュ）なら打ち切らず最後まで辿る（旧形式は再実行で補完される）
- 実機確認: 旧形式キャッシュから1回目実行 → offset=10（全件キャッシュ済みページ）でも打ち切られず
  167ページ全取得 → `complete: true` 保存。2回目 → 2リクエストで打ち切り（下記ログ）

## リトライ対象の限定（レビュー指摘 #5 への対応）
5xx・429・ネットワークエラーのみ再試行（429は Retry-After 尊重、指数バックオフは従来どおり）。
404 など再試行が無意味な4xxは即例外。回帰テスト (m) を追加（404 → fetch呼び出し1回で例外）。

## テスト(d-1) の旧版→新版 差分開示（レビュー指摘 #3 への対応）
Task 1A 本番時に、テスト(d-1)は実装後に書き直しました（同一コミットのため git diff では確認不可。
記憶ベースでの開示です）。

| 項目 | 旧版（実装時に最初に書いた版） | 新版（コミット済み 304a828） |
|---|---|---|
| テスト名 | 「空musicListの回は取得結果で更新され、全員非空になったページで打ち切り」 | 「空musicListの回は取得結果で更新され、以降の完全キャッシュ済みページで打ち切り」 |
| シナリオ | キャッシュ: e1(空)+c1..c9(非空)の10件 / 取得1ページ: 同10件（e1は曲あり、他はFRESH名）nextUrlあり | キャッシュ: e1(空)+c1..c9+c11..c20 の20件 / 1ページ目: 同10件 / 2ページ目: c11..c20 |
| 主要assert | `urls.length === 1`（更新のあったページで即打ち切り） | `urls.length === 2` ＋ `sleeps === [1000]`（更新ページの**次の**完全キャッシュ済みページで打ち切り） |
| 共通assert | e1が更新される / 非空は上書きされない / withMusic 10 / emptyList 0 | 同左（withMusic 20 に変化）＋sleep検証を追加 |

- 書き換えた理由: テスト(a)(b)が実装の打ち切り条件バグ（新規取得した回も「キャッシュ済み」扱いになり
  初回フル取得が1ページで止まる）を検出したため。修正に伴い、旧版の「更新があったページで即打ち切り」という
  期待は仕様（「1ページ全10件がすべて musicList非空で**キャッシュ済み**」= 増分では取得済みのみで打ち切り）と
  齟齬になった
- **弱めていない根拠**: assert は旧版5個 → 新版8個に増加。`urls.length` の期待値 1→2 はシナリオを
  「増分実行」に正しく合わせた結果で、検証内容（打ち切り位置・キャッシュ保持・空の更新）は同等以上。
  assert削除・skip追加・閾値緩和は一切なし

## Red / Green ログ（1A-fix）
**Red（修正テストを先に実行・31件中5件が期待どおり失敗）:**
```
✖ (a) nextUrlを辿って全ページ取得し、キャッシュに保存する
    AssertionError: actual: undefined, expected: true        ← キャッシュに complete が無い
✖ (c) musicList非空でキャッシュ済みのページは全件キャッシュ済みなら再取得せず打ち切り
    AssertionError: actual: undefined, expected: true        ← 同上
✖ (j) 全件取得の途中で中断したら、再実行で打ち切りせず最後まで辿る
    AssertionError: actual: undefined, expected: false       ← 中断時点のキャッシュに complete が無い
✖ (l) completeが無い旧形式キャッシュは打ち切りせず最後まで辿り、完了後にcomplete:true
    AssertionError: actual: 1, expected: 2                   ← 再開バグの再現: 1ページ目で打ち切られる
✖ (m) 404など再試行が無意味な4xxは即例外(リトライしない)
    AssertionError: actual: 4, expected: 1                   ← 404が4回呼ばれている
```

**Green（実装後）:**
```
ℹ tests 31
ℹ suites 5
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1218.5519
```

## 実機確認（1A-fix・ネットワーク通信はこの2回のみ）
**1回目（旧形式キャッシュからのフル再取得・167リクエスト）:**
```
[fetch] GET ...offset=0 → 10件 (保存/更新 6件, キャッシュ済みスキップ 4件)
[fetch] GET ...offset=10 → 10件 (保存/更新 0件, キャッシュ済みスキップ 10件)  ← 旧実装ならここで打ち切り(=再開バグ)
（中略・全167リクエスト、リクエスト間1.2s sleep）
[fetch] GET ...offset=1660 → 2件 (保存/更新 2件, キャッシュ済みスキップ 0件)
--- 集計 (data/episodes.json) ---
総数: 1662 / 曲ありの回数: 22 / 空の回数: 6 / フィールドなしの回数: 1634 / 総曲数: 87（従来と一致）
```
キャッシュ確認: `complete: true, count: 1662, episodes: 1662件`

**2回目（増分・先頭2リクエストで停止）:**
```
[fetch] GET ...offset=0 → 10件 (保存/更新 6件, キャッシュ済みスキップ 4件)
[fetch] GET ...offset=10 → 10件 (保存/更新 0件, キャッシュ済みスキップ 10件)
[fetch] 2ページ目全体がキャッシュ済みのため取得を打ち切り
--- 集計 ---（同上）
```

## Git操作（1A-fix）
- コミットメッセージ：`fix(1A): 未完走キャッシュでは増分打ち切りしない再開制御を追加 (complete フラグ)・4xxはリトライしない`
- コミットID：bb893ea（feat/1a-nhk-fetch）
- ブランチ：feat/1a-nhk-fetch（worktree ../msync-wt-1a）
- push状況：**完了** — `origin = https://github.com/hiroAkikoDy/musicline-spotify-sync.git`（private）に
  main（67f00b8）と feat/1a-nhk-fetch（bb893ea）を push
- CIステータス：**グリーン** — feat/1a-nhk-fetch の run 37741461404:
  `completed success`（job `test in 11s`、全体16s）
  https://github.com/hiroAkikoDy/musicline-spotify-sync/actions/runs/37741461404
  ※ main 単体には ci.yml が無いため main のCI実行なし（1Aマージ時に有効化）

## 変更ファイル一覧（1A-fix）
| ファイル | 変更内容 | 行番号 |
|---|---|---|
| src/nhk/client.js | complete フラグ導入（ロード時の旧形式→false扱い含む）・打ち切り条件に wasComplete 追加・4xx即例外 | 43-52, 92-96, 111-156 |
| test/nhk/client.test.js | 回帰テスト (j)(l)(m) 追加・(a)(c)(d-1) を新スキーマに対応 | 各テスト節 |
| .gitignore | `.kilo/` を追加（push対象外とするため） | 9行目 |

## 完了条件チェック（1A-fix）
- [x] `node --test` 全件通過（Red/Green 両方のログを上記に記載）
- [x] 実機 fetch 1回目: 集計が従来と一致（1662/22/6/1634/87）
- [x] 2回目: 先頭2リクエストで停止、`complete: true` が保存されている
- [x] コミット → `git remote add origin` → feat/1a-nhk-fetch と main を push
- [x] GitHub Actions のグリーン確認（gh run list / view の結果を記載）
- [x] `.kilo/` は push しない（.gitignore に追加済み）
- [x] Work_Report は削除/改変せず追記のみ

## 車検結果（1A-fix）
├── CIグリーン：○（run 37741461404 success）
├── node --test：全31件通過 [○]
├── セキュリティ（分類A）：[○]（公開APIへのGETのみ・シークレットなし・変更なし）
├── 型アノテーション：[○]
└── テストを弱める変更なし：[○]（23→31件。既存(c)(d-1)は complete:true を付与して同一シナリオを維持）

## 注記
- CI annotations: actions/checkout@v4・actions/setup-node@v4 に対し「Node.js 20 deprecated」の警告
  （実行は Node 24 に強制され成功）。今後 actions のメジャー更新を推奨。
- 増分打ち切りの判定基準は「ロード時の complete」のため、1回の実行内で完走フラグが途中で変わることはない。
