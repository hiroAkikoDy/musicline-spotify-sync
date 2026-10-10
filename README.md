# musicline-spotify-sync

NHK-FM「ミュージックライン」の選曲データを取得して、**自分の Spotify アカウントに月別プレイリストとして自動追記する** Node.js 製 CLI ツール（個人利用のみ）。

外部ライブラリ **ゼロ**（Node.js 標準モジュールのみ）で書かれているため、
「Node.js の標準機能だけでどこまで作れるか」を学ぶ教材としても読めるように書いています。

> **この README について**
> 起承転結方式 × 5W1H で各 Phase の物語を記述したドラフトです。
> 実装（`src/**`）・作業記録（`workReport/`）・タスク指示書（`task/`）と突き合わせて最終化する前提で書いています。
> 各章の末尾には「対応するコード / 記録」へのリンクを置いたので、読みながら実装を開いて比較してください。

---

## 1. このプロジェクトの全体像（はじめに読むところ）

### 1-1. 何をするツールか

ラジオ番組「ミュージックライン」（NHK-FM）の Web API には、放送回ごとの選曲リスト（`musicList`）が含まれています。
このツールは次の 3 ステップを 1 コマンドずつで実現します。

```
node src/index.js fetch          # (1) NHK から全エピソードと選曲を取得 → data/episodes.json にキャッシュ
node src/index.js sync --dry-run # (2) Spotify検索でマッチング → 追加予定の確認だけ（書き込まない）
node src/index.js sync           # (3) 月別プレイリスト（例: ミュージックライン 2026-10）を作成・追記
```

### 1-2. データの流れとモジュール対応

```
[NHK API] --fetch--> data/episodes.json(キャッシュ)
        |
        v
src/nhk/normalize.js  選曲リストを {title, artist, durationSec, episodeId, airDate} に正規化
        |
        v
src/sync/plan.js      放送月(JST)ごとにグルーピング。テーマ曲除去・月跨ぎ重複の排除・--limit の選択
        |
        v
src/sync/runMatch.js  src/spotify/search.js で Spotify検索 → src/match/score.js で採点 → pickBest で採用決定
        |             （候補0件・低スコアのときは artist 抜きで再検索するフォールバック付き）
        v
src/sync/apply.js     月ごとにプレイリスト作成 → 重複を除いて追加 → data/state.json に反映
        |             （「真実はSpotify側」: 追加後は必ずプレイリストを読み直して state に記録）
        v
[Spotify]  ミュージックライン 2026-09 / ミュージックライン 2026-10 / ...（非公開運用も可）
```

### 1-3. ディレクトリ対応表

| ディレクトリ / ファイル | 役割 | 学べる Node.js の要素 |
|---|---|---|
| `src/nhk/client.js` | NHK API の取得（ページング・sleep・リトライ・キャッシュ） | fetch, async/await, whileループ, setTimeout, fs の原子書き込み |
| `src/nhk/normalize.js` | 全角→半角などの正規化・曲のキー生成・選曲抽出 | NFKC 正規化, 正規表現, 純粋関数 |
| `src/nhk/duration.js` | `PT4M54S` → `294` 秒 | 正規表現とキャプチャ, 数値変換の落とし穴 |
| `src/match/score.js` | 曲名/アーティスト/再生時間の配点計算 | 定数の一元管理, 早期リターン, 純粋関数のテスト |
| `src/spotify/pkce.js` | PKCE のコード生成 | node:crypto（SHA256・乱数）, base64url |
| `src/spotify/auth.js` | OAuth 認可コード + PKCE フロー | node:http でのローカル待ち受け, child_process でブラウザ起動 |
| `src/spotify/tokenStore.js` | トークンの保存と自動更新 | JSON の原子的書き込み, chmod, 期限管理 |
| `src/spotify/client.js` | API 共通ラッパ（Bearer・401再試行・429待機） | 高階関数, while 再試行, ヘッダー操作 |
| `src/sync/state.js` | 処理済みの記録（イミュータブル更新） | スプレッドでのオブジェクト複製, 破壊的変更の回避 |
| `test/**/*.test.js` | node:test によるユニットテスト | テストファースト, モック, assert |
| `.github/workflows/ci.yml` | push/PR でテストを自動実行 | GitHub Actions の最小構成 |

### 1-4. 技術スタック

- Node.js **20 以上**（ESM・組み込み fetch を使用。開発は v24）
- 外部パッケージ **0 個**（`package.json` に dependencies なし）
- テスト: `node --test`（185件）
- CI: GitHub Actions（push/PR で `node --test`）

---

## 2. Phase 0 — 雛形を作り、API の癖を知る

### 5W1H サマリ

| 問い | 答え |
|---|---|
| When（いつ） | 2026-10-08 以前（Phase 1 の着手前） |
| Who（誰が） | 開発者 + Kilo Code（実装担当エージェント） |
| What（何を） | プロジェクト雛形・.gitignore・README の作成と、NHK 一覧API の実調査 |
| Why（なぜ） | 実装前に「API が本当に何を返すのか」を知らないと、設計が空想になるから |
| Where（どこで） | `scripts/survey.js` → `out/survey_raw.json` |
| How（どうやった） | 一覧APIを先頭3ページ+末尾2ページだけ叩き、生JSONを保存して集計 |

### 起 — なぜいきなり実装しなかったのか

「ラジオの選曲を Spotify に同期したい」を実現するには、まず**元データがどこまで取れるのか**を知る必要がありました。
NHK の番組 API は公式ドキュメントが限られ、実際にリクエストしてみないと分からないことが多いためです。
そこで本実装の前に、調査専用スクリプト `scripts/survey.js`（`npm run survey`）だけを用意しました。

### 承 — 何を調査し、どう実装したか

一覧API `https://api.nhk.jp/r8/l/radioepisode/pl/series-rep-Z9WGYY3GP5.json?offset=0` に対して、
先頭3ページ（新しい回）と末尾2ページ（古い回）を取得して `out/survey_raw.json` に保存しました。
1ページ10件・`nextUrl` を辿るページング方式で、全件数は `count` フィールドで分かります。

### 転 — 調査で見えた「想定外」

調査の結果、単純な「全回の選曲リスト」ではないことが分かりました。

- 全エピソード数は **1662回**（2026-10-08 時点。2020年1月以降の放送分が蓄積）
- **選曲データ（`musicList`）があるのは直近約1ヶ月分（2026-09-08 以降の28回・全87曲）だけ**
- それ以前の古い回は `detailedRecentEvent.misc` オブジェクト自体が存在しない（空配列ですらない）
- まだ放送されていない未来の回は `musicList: []`（空配列）で、放送後に埋まる

つまり「全期間の選曲を取得する」という当初の狙いは API の仕様上不可能で、
**「直近の放送分を増分で同期する」ツール**として設計を変えることが、この時点で確定しました。

### 結 — この Phase で得たもの

- 生JSONをそのまま保存する調査スクリプトの型（後から何度でも再分析できる）
- 「曲がある回 / 空の回 / フィールド自体が無い回」の3種類を区別する設計方針
- Node.js の `fetch`・`JSON.parse`・`fs` の基本（雛形のコードは数十行ですが、以降の全ての土台です）

> 対応: `scripts/survey.js` / 記録: `workReport/`（Phase 0 分は 1A の報告書の背景欄にも反映）

---

## 3. Phase 1 — fetch の実装（キャッシュ・sleep・正規化・duration変換）

### 5W1H サマリ

| 問い | 答え |
|---|---|
| When | 2026-10-08（Task 1A） |
| Who | 開発者 + Kilo Code（red/green TDD で実装） |
| What | NHK取得コマンド `fetch`（キャッシュ・sleep・リトライ付き）と、正規化・duration変換のユニットテスト |
| Why | 手で API を叩くのは危険（サーバー負荷）で、再実行のたびに全件取り直すのは非効率だから |
| Where | `src/nhk/**`, `src/index.js`, `test/nhk/**` |
| How | テストを先に書いて失敗を確認（Red）→ 実装して通す（Green）を繰り返す red/green TDD |

### 起 — なぜ「キャッシュ・sleep・正規化」が必須だったか

Phase 0 で分かった制約が、そのまま実装要件になりました。

- 全 1662 回を取得するには **167 リクエスト**必要 → 連続で叩くとサーバーに負担 → **1.2秒の sleep** を挟む
- 取得に失敗したら最初からやり直しでは非効率 → **ページ単位でキャッシュに保存**（中断しても続きから）
- 曲名に全角英数（`ｔｏｍａｔｏ`）や連続空白が混在している → **NFKC 正規化**してから検索に使う
- Spootify の検索に渡す再生時間は秒数が必要 → ISO8601 形式（`PT4M54S`）を**秒に変換**する

### 承 — 何をどう作ったか

`src/nhk/client.js` の `fetchAllEpisodes()` に、次の動作を全部入れました。

1. `?offset=0` から `nextUrl` を辿って全ページ取得
2. リクエスト間に 1.2 秒 sleep（未満を指定したらエラー）
3. HTTP エラーは指数バックオフ（1秒→2秒→4秒）で3回リトライ。429 は `Retry-After` ヘッダーを尊重
4. ページごとに `data/episodes.json` へ原子的保存（一時ファイル→rename。中断しても壊れない）
5. 「全ページがキャッシュ済み」の増分実行ではそこで打ち切り（2回目以降は数リクエストで終わる）

正規化は `src/nhk/normalize.js` に集約しました。

- `normalizeText()`: NFKC 正規化 → 前後 trim → 連続空白を1つに（`ｔｏｍａｔｏ` が `tomato` になる）
- `makeTrackKey()`: `title|artist` を正規化・小文字化した重複排除キー（Phase 4 まで使い続ける重要な関数）
- `parseIsoDuration()`: `PT4M54S` → `294`（不正値は `null`）

テストは **テストを先に書いて失敗を確認（Red）** してから実装（Green）する方式を取り、
Phase 1 だけで 31 件書きました。

### 転 — 実装中に起きた問題と発見

- **時差の罠**: 放送日時は JST（+09:00）だが `Date` は UTC 基準。`2026-09-30T15:00:00Z` は JST では 10月1日。
  月別グルーピングでは「+9時間してから UTC として読む」テクニックが必要になりました（`src/sync/plan.js`）
- **未来の回の扱い**: 未放送回は `musicList: []`。放送後に埋まるため「曲を持つ回だけを対象にする」
  ルールにしました（放送後に自動で対象になる）
- **インフラの文字化け**: PowerShell の `Get-Content | Set-Content` でファイルを書き換えると
  UTF-8 の日本語が破損しました。以後「ファイル編集は node かエディタで行う」をルール化

### 結 — 結果と学び

- **1662 回分のエピソード**を `data/episodes.json` にキャッシュ完了（選曲データは直近1ヶ月分の28回・全87曲）
- 再実行は数リクエストで終わる増分動作を確認
- **学び**: 外部 API を扱うコードは「sleep・リトライ・キャッシュ」の3点セットがあれば大抵堅牢です。
  そしてこの3点セットは、テストを書きやすい形（sleep 関数や fetch を引数で注入できる設計）にしておくと
  テストが爆速になります

> 対応コード: `src/nhk/**`, `src/index.js`（fetch 部）/ 記録: `workReport/2026-10-08_task_1A_nhk_fetch.md`

---

## 4. Phase 2 — Spotify 認証（PKCE）

### 5W1H サマリ

| 問い | 答え |
|---|---|
| When | 2026-10-08（Task 1B） |
| Who | 開発者 + Kilo Code |
| What | PKCE 方式の OAuth 認証。ブラウザログイン → 自分のユーザー情報取得まで |
| Why | ユーザーのプレイリストを操作するにはユーザー認可が必要。かつ Client Secret を扱わない安全な方式にするため |
| Where | `src/spotify/{pkce,auth,tokenStore,client}.js`, `scripts/auth_check.js` |
| How | 公式ドキュメントを裏取り → TDD → 実機ログインで `GET /me` を確認 |

### 起 — なぜ PKCE なのか

Spotify の Web API には複数の認可方式がありますが、**Authorization Code + PKCE** を選びました。

- Client Secret が不要（公開リポジトリに秘密情報が絶対に乗らない）
- 個人ツールなので「ブラウザでログイン → ローカルサーバーがコールバックを受け取る」流れが自然
- 2026年2月の Dev Mode 変更後も推奨される方式

### 承 — 何をどう作ったか

認証の全体像は次のとおりです。

```
(1) node:crypto で code_verifier(43-128文字のランダム文字列) と
    code_challenge(SHA256→base64url) を生成
(2) ブラウザで https://accounts.spotify.com/authorize?...&code_challenge_method=S256&code_challenge=... を開く
(3) ユーザーがログイン・認可すると http://127.0.0.1:8888/callback?code=...&state=... にリダイレクト
(4) src/spotify/auth.js の startCallbackServer() が code を受け取る（state不一致・error・
    タイムアウトは拒否。1回受けたらサーバーを閉じる）
(5) POST https://accounts.spotify.com/api/token に code + code_verifier + client_id を送る
    （PKCE では Basic認証ヘッダーではなく body に client_id を載せる点がポイント）
(6) access_token / refresh_token を data/spotify_token.json に保存（chmod 0600 試行）
```

`scripts/auth_check.js` を実行するとこの流れが全部動き、最後に `GET /me` で
`display_name` / `id` を表示します（実機で `hiro-a-ki` を確認）。

### 転 — 調査で判明した 2026年仕様変更

実装前に公式ドキュメントを裏取りした結果、2026年2月の Dev Mode 変更で次が判明しました。

- `GET /me` から `country` / `email` / `product` などのフィールドが**削除対象**になっている
  → 実機確認の結果、実際に `product` は取得できませんでした（コードは無い場合の表示に対応済み）
- `refresh_token` には約6ヶ月の寿命があり、失効したら再認証が必要
- 更新応答に新しい `refresh_token` が無い場合は**旧値を使い続ける**仕様（保存時に保持を実装）

### 結 — 結果と学び

- ブラウザログイン → トークン保存 → `GET /me` でユーザー情報表示まで完了
- 2回目以降はブラウザが開かず、保存トークンで即完了することも確認
- **学び**: OAuth は「ライブラリに任せきり」にすると何が起きているか分からなくなります。
  標準モジュールだけで書くと、state 検証（CSRF対策）・スコープ・トークンの寿命が手に取るように分かります

> 対応コード: `src/spotify/pkce.js` `auth.js` `tokenStore.js` / 記録: `workReport/2026-10-08_task_1B_spotify_auth.md`

---

## 5. Phase 3 — 検索マッチング（--dry-run で直近20回を検証）

### 5W1H サマリ

| 問い | 答え |
|---|---|
| When | 2026-10-09（Task 3A マッチング理論 / 3B Spotify検索 / 3C dry-run結合） |
| Who | 開発者 + Kilo Code（3A・3B は並列実装） |
| What | Spotify検索ラッパ・配点による採用判定・`sync --dry-run` の結合。直近20回でマッチ率を検証 |
| Why | 書き込みの前に「どれだけ正しくマッチするのか」「危険な誤マッチはないか」を数で把握するため |
| Where | `src/match/**`, `src/spotify/search.js`, `src/sync/{plan,runMatch,report}.js` |
| How | 採点は配点表（定数）で決定論的に。実機の前に dry-run で必ず結果を出して人間が確認 |

### 起 — なぜ「採点」が必要か

NHK の曲名・アーティスト表記と Spotify の登録名は完全一致しません。

- 全角英数: NHK「ｔｏｍａｔｏ」= Spotify「tomato」（NFKC で吸収できる）
- ローマ字表記: NHK「超ときめき♡宣伝部」= Spotify「Cho Tokimeki Sendenbu」（**表記ゆらぎでは吸収できない**）
- 曲名の副題: 「心配無用節 -無添加-」のような括弧・ハイフン部分

そこで「曲名・アーティスト・再生時間」の3要素に配点を与え、合計スコアが閾値（60点）以上の
候補だけを採用する**決定論的な採点方式**にしました。AI に任せずルールでやることで、
「なぜこの曲が選ばれたのか」が常に説明できます。

### 承 — 何をどう作ったか

配点は `src/match/score.js` の `WEIGHTS` 定数に集約しました。

| 要素 | 条件 | 配点 |
|---|---|---|
| 曲名 | 完全一致（正規化後・小文字） | +50 |
| 曲名 | 部分一致（片方が他方を含む） | +25 |
| コア曲名 | 括弧と「 - 」以降を除いた曲名で完全一致 | +40（曲名配点の高い方のみ採用） |
| アーティスト | 完全一致 | +40 |
| アーティスト | 部分一致 | +20 |
| 再生時間 | 差が ±5秒以内 | +10 |

検索は `track:"曲名" artist:"アーティスト"` のクォート付き構文（`src/spotify/search.js` の `buildQuery`）。
0件のときだけ artist 抜きで再検索するフォールバック（`searchWithFallback`）を付けました。

### 転 — dry-run で見えた現実

`sync --dry-run --limit 20`（直近20回・58曲）の結果:

- マッチ率 **96.6%**（56/58）・未マッチ 2曲
- **アーティスト点が 0 のまま採用された曲が 11件**（全員ちょうど60点=曲名完全一致50+時間10）
  → 原因は Spotify がアーティスト名をローマ字で返すこと（超ときめき♡宣伝部 → Cho Tokimeki Sendenbu）
- 曲名が部分一致での誤採用は 0件（レビューで懸念された「Love / Love Story」型の事故は起きなかった）

ここでユーザーが判断を下しました: **採点ルールは現状のまま変更しない**（この判断は `起点：判例/3C-採点ルール変更/却下` として記録）。

### 結 — 結果と学び

- 直近20回を csv レポート（`out/unmatched.csv` / `out/matched_preview.csv`・BOM付き）で出力
- **学び**: 書き込み系の機能は「dry-run で数字を出して人間が判断する」工程を挟むと、
  不安なまま本番に進まなくて済みます。判断材料（内訳表・一覧）を出すコードも製品コードの一部です

> 対応コード: `src/match/**`, `src/spotify/search.js`, `src/sync/{plan,runMatch,report}.js`
> 記録: `workReport/2026-10-09_task_3A_*.md` `2026-10-09_task_3B_*.md` `2026-10-09_task_3C_*.md`

---

## 6. Phase 4 — 実際にプレイリストを作る（--limit 20 → 全期間）

### 5W1H サマリ

| 問い | 答え |
|---|---|
| When | 2026-10-10（Task 4A プレイリストAPI / 4B state管理 / 4C 書き込み結合） |
| Who | 開発者 + Kilo Code。**実機への書き込みは各段階でユーザー承認を取ってから実行** |
| What | プレイリスト作成・追加のAPIラッパ、`data/state.json`（処理済み記録）、`sync` 書き込みモード |
| Why | 再実行しても二重追加しない「冪等」な同期を実現するため |
| Where | `src/sync/apply.js`, `src/sync/state.js`, `src/spotify/playlist.js`, `src/index.js` |
| How | dry-run → ユーザー承認 → `--limit 3` で初回書き込み → 目視確認 → 冪等再実行 → `--limit 20` → 全件、の段階拡大 |

### 起 — なぜ state.json と「段階的拡大」が必要か

Spotify への書き込みは取り消しが面倒です（削除系APIは本プロジェクトでは不使用と決めている）。
そのため次の2つの安全装置を設計しました。

1. **state.json**: 処理済みの回・追加済みの曲（makeTrackKey）・月別プレイリストIDを記録。
   破壊的な更新は禁止（全ての更新関数は新しい state を返す純粋関数）。壊れた JSON は例外にして
   自動上書きしない（データ消失防止）
2. **段階的拡大**: dry-run → 承認 → `--limit 3`（最初は3回分だけ）→ Spotifyアプリで目視確認 →
   再実行で追加0件（冪等確認）→ `--limit 20` → 全件

### 承 — 何をどう作ったか

書き込みの本体 `src/sync/apply.js` の流れは次のとおりです。

1. 処理済みの回を対象から外す（`isEpisodeProcessed`）
2. 追加済みの曲は検索しない（`hasTrack(makeTrackKey)` → 検索APIの節約）
3. 検索・採点（既存の `runMatch`。読み取りのみ）
4. 月ごとに: プレイリストが無ければ作成（`POST /me/playlists`・非公開指定）→ **直後に state 保存**
5. `listPlaylistUris` で**実際のプレイリスト内容を読み直し**、重複を除いて `addTrackUris`（100件ずつ分割POST）
6. 追加後ももう一度 list を読み直し、**実際にプレイリストへ入った曲だけ**を state に記録
   （=「真実はSpotify側」原則。失敗時に `added` から推測しない）
7. 回の処理が完了したら `markEpisode`、未マッチを `recordUnmatched` → 保存

### 転 — 実機で発見した3つのバグと、Spotifyの癖

実機テストは、ユニットテストでは見えない問題を3つも掘り出しました。

1. **markEpisode の範囲バグ**: 処理済み記録が「plan で選択した回」ではなく**キャッシュ全件（1662回）**に
   及んでいた。`--limit` 選択外・未放送の回まで「処理済み」になり、以後永遠に同期されない重大バグ。
   state.json を見ていたから気付けた（回帰テスト追加 → 修正 → 実機の state も修復）
2. **`--limit` の解釈**: 最初の実装は「未処理からN回」だったため、同じコマンドの再実行で次のバッチを
   追加してしまい、冪等確認（追加0件）が失敗。「新しい順N回を選択（処理済みを含む）→ 処理済みを除外」
   の順序に修正して冪等になりました
3. **Spotify の癖**: `POST /me/playlists` の `public: false` は無視され、プレイリストが公開で作成される
   （リクエストの捕捉・現在値の GET で調査済み。ユーザーが「公開のままで良い」と承認）

### 結 — 結果と学び

実機の最終結果（Spotify API で確認、state.json と完全一致）:

| プレイリスト | 曲数 |
|---|---|
| ミュージックライン 2026-10 | 15曲 |
| ミュージックライン 2026-09 | 48曲 |
| **合計** | **63曲** |

最終冪等再実行では追加 0件・全22回が処理済みスキップ。以降は「週次で `fetch` → `sync`」するだけで、
新しく放送されて選曲が公開された回だけが月別プレイリストに追記されます。

- **学び**: 冪等性は「既存を確認してから追加する」だけでなく「処理済み記録の適用順序」まで含めて設計する。
  そして外部サービスに対する操作は「自分の記録」より「相手側の実際の状態」を信じる

> 対応コード: `src/sync/apply.js` `state.js`, `src/spotify/playlist.js` / 記録: `workReport/2026-10-10_task_4A〜4C_*.md`

---

## 7. セットアップ

### 7-1. 前提

- Node.js 20 以上（ESM。外部パッケージ不要なので `npm install` は不要）
- Spotify アカウント（開発者ダッシュボードでアプリを作成し、
  リダイレクトURI `http://127.0.0.1:8888/callback` を登録）
- NHK API / Spotify API は公開・個人利用の範囲で使用（負荷配慮のため sleep を内蔵）

### 7-2. 手順

```powershell
# 1. .env を用意（Spotifyダッシュボードの Client ID を設定）
Copy-Item .env.example .env
#   SPOTIFY_CLIENT_ID=<あなたのClient ID>
#   SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback

# 2. Spotify 認証（ブラウザが開く・初回のみ）
node scripts/auth_check.js

# 3. NHK からエピソード取得（初回は約167リクエスト・数分。2回目以降は増分）
node src/index.js fetch

# 4. dry-run でマッチング結果を確認（書き込みなし）
node src/index.js sync --dry-run --limit 20

# 5. 書き込み（計画表示 → [y/N] 確認 → 月別プレイリスト作成・追記）
node src/index.js sync --limit 20
node src/index.js sync            # 全件（2回目以降は追加0件で終わる = 冪等）
```

### 7-3. 主なオプション

| オプション | 意味 |
|---|---|
| `--dry-run` | 書き込みせず結果レポートと CSV（`out/`）だけ出力 |
| `--since YYYY-MM-DD` | 放送日（JST）が指定日以降の回だけ対象 |
| `--limit N` | 新しい順に N 回だけ対象 |
| `--include-theme` | テーマ曲（NEW POINT / 西岡大貴）も対象にする（既定は除外） |
| `--min-score N` | 採用スコアの閾値（既定 60） |
| `--yes` | 書き込み前の確認プロンプトを省略 |

### 7-4. 生成されるファイル（すべて .gitignore 済み）

| ファイル | 内容 |
|---|---|
| `data/episodes.json` | NHK エピソードのキャッシュ（増分更新） |
| `data/spotify_token.json` | Spotify トークン（自動更新・chmod 0600 試行） |
| `data/state.json` | 処理済み回・追加済み曲・月別プレイリストID |
| `out/unmatched.csv` / `out/matched_preview.csv` | dry-run の結果レポート（BOM付き・Excel対応） |

---

## 8. テストと CI

```powershell
node --test        # 全185件が走る（fail 0 / skip 0）
```

- すべて `node:test`（Node.js 組み込み）。外部テストライブラリ不要
- 通信するコード（fetch・sleep・playlist API）は**全て引数で注入できる**ため、
  ユニットテストは実通信ゼロで動く
- CLI の動作は子プロセスとして `node src/index.js` を起動して検証（`test/sync/cli.test.js`）
- CI（`.github/workflows/ci.yml`）は push/PR で `node --test` を実行するだけの最小構成

テスト方針:

1. **テストを先に書く**（red/green TDD）。失敗出力は作業記録に残す
2. テストを弱めない（assert の削除・skip 追加・閾値緩和は禁止）
3. 通信・時刻・sleep は注入して決定的にする
4. 日本語リテラルはそのまま書いてよい。ただし **PowerShell の `Get-Content | Set-Content` で
   ファイルを書き換えない**（UTF-8 日本語が破損する。編集はエディタか node で行う）

---

## 9. 設計の決まりごと（コードを読むときの道標）

| 原則 | 内容 | 実装箇所 |
|---|---|---|
| 純粋関数を優先 | 更新系は入力を破壊せず新しい値を返す（テストが書きやすい） | `src/sync/state.js`, `src/match/**` |
| 真実はAPI側 | state の記録より、Spotify の実際の状態を信じる（追加後は必ず読み直す） | `src/sync/apply.js` |
| 決定論的な採用 | マッチ判定は配点表（定数）で説明可能にする。AI や確率を使わない | `src/match/score.js` |
| 段階的な安全装置 | dry-run → 承認 → limit 3 → 目視 → 冪等確認 → 拡大 | `src/index.js`, `src/sync/apply.js` |
| 原子的書き込み | 一時ファイル → rename で中途半端なファイルを作らない | `src/nhk/client.js`, `src/spotify/tokenStore.js`, `src/sync/state.js` |
| サーバーへの配慮 | sleep・リトライ（指数バックオフ + Retry-After）・増分取得 | `src/nhk/client.js`, `src/spotify/client.js` |

---

## 10. このリポジトリをフォークして学ぶ（改変のアイデア）

Phase 0〜4 のコードは独立したモジュールに分かれているので、1か所だけ変えても動きます。
難易度順の例:

| アイデア | 触る場所 | 学べること |
|---|---|---|
| テーマ曲を含める/除外の閾値を変える | `src/index.js`, `src/match/score.js` | オプション解析と定数の影響範囲 |
| 未マッチ曲のレポートに検索クエリを足す | `src/sync/report.js` | CSV 設計とエスケープ |
| 別のラジオ番組・別APIに対応させる | `src/nhk/client.js` を差し替える新モジュール | 戦略パターン（差し替え可能な取得器） |
| 週次で自動実行する GitHub Actions を追加 | `.github/workflows/` | cron と secrets の扱い |
| プレイリスト名の規則を変える（年度まとめ等） | `src/sync/plan.js` の月グルーピング | グルーピングと state 設計の連動 |
| 曲名の類似度スコア（レーベンシュタイン距離）を追加 | `src/match/score.js` | アルゴリズム実装とテスト |

---

## 11. ドキュメント一覧（詳細記録）

| 記録 | 内容 |
|---|---|
| `workReport/2026-10-08_task_1A_nhk_fetch.md` | Phase 1 の実装記録（Red/Greenログ・NHK API の癖） |
| `workReport/2026-10-08_task_1B_spotify_auth.md` | Phase 2 の実装記録（PKCE・2026年仕様変更調査） |
| `workReport/2026-10-08_task_1C_survey.md` | 単体取得API調査（過去回に選曲データが無いことの裏取り） |
| `workReport/2026-10-09_task_3A_matching_logic.md` | 採点ロジックの設計とテスト |
| `workReport/2026-10-09_task_3B_spotify_search.md` | 検索ラッパとクォート付き構文の実機検証 |
| `workReport/2026-10-09_task_3C_sync_dry_run.md` | dry-run 結合・マッチ率96.6%・リスク分析 |
| `workReport/2026-10-10_task_4A_playlist_api.md` | プレイリストAPIラッパ（Feb 2026 変更の裏取り） |
| `workReport/2026-10-10_task_4B_state_store.md` | state.json 設計（イミュータブル・壊れ保護） |
| `workReport/2026-10-10_task_4C_sync_write.md` | 書き込み結合・実機63曲同期・発見バグ3件の記録 |
| `task/task_*.md` | 各タスクの指示書（要件と受け入れ基準） |

---

## 12. 注意

- 本ツールは個人利用。Spotify の開発者規約（Dev Mode は5ユーザーまで等）と NHK API への配慮
  （sleep・キャッシュ）の範囲で使用してください
- トークン（`data/spotify_token.json`）と `.env` は絶対にコミットしない（`.gitignore` 済み）
- Spotify の仕様は変動します（2026年2月の大変更の記録は Work_Report 冒頭を参照）
