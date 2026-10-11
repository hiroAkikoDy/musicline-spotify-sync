# musicline-spotify-sync

NHK-FM「ミュージックライン」の選曲データを取得して、**自分の Spotify アカウントに月別プレイリストとして自動で追記する** Node.js 製の CLI ツールです（個人利用向け）。

- 外部ライブラリは **ゼロ**。Node.js の標準モジュールだけで書かれています
- 全体で 201 本のユニットテスト付き（2026-10-11 時点）。通信するコードも、テストでは実際には通信しません
- **Node.js を学ぶための教材**として読めるように、各 Phase を「起承転結 × 5W1H」で書き残しています
- **フォークして別の番組・別の用途に作り変える**ことを想定して、改変の入口も案内しています

## この README の読み方

| あなたが… | 読む場所 |
|---|---|
| まず動かしてみたい | [8. セットアップ](#8-セットアップ) |
| コードを読んで Node.js を学びたい | [1. 全体像](#1-全体像) → [2. 学習ガイド](#2-学習ガイド読む順番とclaudeへの質問例) |
| どう作られたかの物語を読みたい | [3. 開発の記録（Phase 0〜5）](#3-開発の記録起承転結--5w1h) |
| フォークして作り変えたい | [11. フォークして作り変える](#11-フォークして作り変える) |

---

## 1. 全体像

### 1-1. 何をするツールか

ラジオ番組「ミュージックライン」（NHK-FM）の Web API には、放送回ごとの選曲リスト（`musicList`）が含まれています。
このツールは、それを Spotify のプレイリストに変換します。操作は 3 つのコマンドだけです。

```
node src/index.js fetch           # (1) NHK から全エピソードを取得 → data/episodes.json にキャッシュ
node src/index.js sync --dry-run  # (2) Spotify で検索してマッチング → 追加予定を確認するだけ（書き込まない）
node src/index.js sync            # (3) 月別プレイリスト（例: ミュージックライン 2026-10）を作成・追記
```

### 1-2. データの流れとモジュールの対応

```
[NHK API] --fetch--> data/episodes.json（キャッシュ）
        |
        v
src/nhk/normalize.js  選曲リストを {title, artist, durationSec, episodeId, airDate} に正規化
        |
        v
src/sync/plan.js      放送月(JST)ごとにグルーピング。テーマ曲の除外・月をまたぐ重複の排除・--limit の選択
        |
        v
src/sync/runMatch.js  src/spotify/search.js で検索 → src/match/score.js で採点 → pickBest で採用を決定
        |             （候補が0件、または低スコアのときは、曲名だけで再検索するフォールバック付き）
        v
src/sync/apply.js     月ごとにプレイリストを作成 → 重複を除いて追加 → data/state.json に記録
        |             （「真実は Spotify 側」: 追加後は必ずプレイリストを読み直して state に記録する）
        v
[Spotify]  ミュージックライン 2026-09 / ミュージックライン 2026-10 / ...
```

### 1-3. ディレクトリと、学べる Node.js の要素

| ファイル | 役割 | 学べること |
|---|---|---|
| `src/nhk/client.js` | NHK API の取得（ページング・sleep・リトライ・キャッシュ） | `fetch`、`async/await`、`while` ループ、`setTimeout`、ファイルの原子的な書き込み |
| `src/nhk/normalize.js` | 全角→半角などの正規化、曲のキー生成、選曲の抽出 | NFKC 正規化、正規表現、純粋関数 |
| `src/nhk/duration.js` | `PT4M54S` → `294`（秒） | 正規表現のキャプチャ、数値変換の落とし穴 |
| `src/match/score.js` | 曲名・アーティスト・再生時間の配点計算 | 定数の一元管理、純粋関数のテスト |
| `src/match/pickBest.js` | 最良の候補を選び、閾値で足切り | 並べ替えと同点処理 |
| `src/match/theme.js` / `dedupe.js` | テーマ曲の除外、重複の排除 | 配列操作、`Set` |
| `src/spotify/pkce.js` | PKCE のコード生成 | `node:crypto`（SHA256・乱数）、base64url |
| `src/spotify/auth.js` | OAuth 認可コード + PKCE のフロー | `node:http` でのローカル待ち受け、`child_process` でのブラウザ起動 |
| `src/spotify/tokenStore.js` | トークンの保存と自動更新 | JSON の原子的書き込み、期限管理 |
| `src/spotify/client.js` | API 共通ラッパ（Bearer・401 の再試行・429 の待機） | 高階関数、再試行ループ、ヘッダー操作 |
| `src/spotify/search.js` / `playlist.js` | 検索、プレイリストの作成・取得・追加 | クエリ文字列の組み立てとエンコード、ページング、100件ずつの分割 |
| `src/sync/state.js` | 処理済みの記録（イミュータブルな更新） | スプレッド構文によるオブジェクトの複製 |
| `src/sync/apply.js` | 書き込みの本体 | 処理の順序設計、失敗時の再開 |
| `test/**/*.test.js` | `node:test` によるユニットテスト | テストファースト、モック、`assert` |
| `.github/workflows/ci.yml` | push / PR でテストを自動実行 | GitHub Actions の最小構成 |

### 1-4. 技術スタック

- Node.js **20 以上**（ESM・組み込み `fetch` を使用。開発は v24）
- 外部パッケージ **0 個**（`package.json` に dependencies はありません。`npm install` は不要です）
- テスト: `node --test`
- CI: GitHub Actions（push / PR で `node --test`）

---

## 2. 学習ガイド（読む順番と、Claude への質問例）

このリポジトリは「小さく単純なものから、大きく複雑なものへ」の順に読むと理解しやすくなります。
お手持ちの Node.js の参考書の該当章と、並べて読むことをおすすめします。

### 2-1. 読む順番

| 順 | 読むコード | まず読むテスト | 参考書で対応する章 | 身につくこと |
|---|---|---|---|---|
| 1 | `src/nhk/duration.js` | `test/nhk/duration.test.js` | 文字列・正規表現・数値 | 純粋関数と、入力が不正なときの扱い（`null` を返す） |
| 2 | `src/nhk/normalize.js` | `test/nhk/normalize.test.js` | 文字列・`String.prototype.normalize` | 全角/半角の揺れを吸収する設計 |
| 3 | `src/match/score.js` | `test/match/score.test.js` | 関数・オブジェクト・定数 | ルールを「配点表」として書き、テストで固定する |
| 4 | `src/sync/state.js` | `test/sync/state.test.js` | `fs` モジュール・JSON・スプレッド構文 | 元の値を壊さない更新、壊れたファイルを上書きしない設計 |
| 5 | `src/nhk/client.js` | `test/nhk/client.test.js` | 非同期処理（`async/await`）・HTTP・`fetch` | リトライ、sleep、キャッシュ。`fetch` を引数で差し替える設計 |
| 6 | `src/spotify/pkce.js` → `auth.js` → `tokenStore.js` | `test/spotify/` | `node:crypto`・`node:http`・OAuth | 認証の仕組みを標準モジュールだけで書く |
| 7 | `src/spotify/client.js` → `search.js` → `playlist.js` | `test/spotify/` | 高階関数・API クライアント | 401・429 の再試行、ページング、分割送信 |
| 8 | `src/sync/plan.js` → `runMatch.js` → `apply.js` | `test/sync/` | モジュール設計 | 小さな部品をつなぎ、失敗しても続きから再開できるようにする |

> **ヒント:** 各ファイルは「テストを先に読む」と、関数が何をする約束なのかが分かります。

### 2-2. Claude に質問するときの例

リポジトリを公開（public）にしておくと、Claude にリポジトリのコードを読ませて質問できます。
次のように「ファイル名」「知りたいこと」「自分の理解」を添えると、答えが具体的になります。

- 「`src/nhk/client.js` の `fetchJsonWithRetry` で、なぜ `while (true)` ではなく `for (let attempt = 0; ; attempt++)` を使っているのか、説明してください」
- 「`src/sync/state.js` の更新関数が、元の state を書き換えずに新しい state を返す理由と、書き換えた場合に何が起きるかを教えてください」
- 「`src/spotify/auth.js` の `startCallbackServer` を、1 行ずつ読み解きたいです。`http.createServer` のコールバックがいつ呼ばれるのかから説明してください」
- 「`test/nhk/client.test.js` が、実際に通信せずに `fetchAllEpisodes` をテストできている仕組みを、依存性の注入という言葉を使って説明してください」
- 「`src/match/score.js` に、曲名の類似度（レーベンシュタイン距離）の加点を追加したいです。どこをどう変えるのが安全ですか?」

### 2-3. 用語集

| 用語 | 意味（このプロジェクトでの使われ方） |
|---|---|
| ESM | `import` / `export` を使う、モジュールの書き方（`package.json` の `"type": "module"`） |
| 純粋関数 | 同じ入力なら必ず同じ出力を返し、外の状態を変えない関数。テストしやすい |
| 冪等（べきとう） | 同じ操作を何度実行しても、結果が変わらないこと。`sync` を再実行しても曲が二重に追加されない |
| 原子的な書き込み | 一時ファイルに書いてから名前を変える方式。途中で止まっても、壊れたファイルが残らない |
| NFKC 正規化 | 全角英数を半角にそろえるなど、見た目が同じ文字を同じ表現にする正規化 |
| PKCE | クライアントシークレットなしで、安全にブラウザ認証をするための OAuth の方式 |
| dry-run | 書き込みを行わず、「何をするか」だけを表示する実行モード |
| 依存性の注入 | `fetch` や `sleep` を関数の引数として受け取り、テストでは偽物に差し替えられるようにする設計 |
| Red / Green | テストを先に書いて失敗させ（Red）、実装して通す（Green）という開発の進め方 |

---

## 3. 開発の記録（起承転結 × 5W1H）

各 Phase を、次の形で書いています。

- **5W1H サマリ**: いつ・誰が・何を・なぜ・どこで・どうやったか
- **起**: なぜそれが必要になったか
- **承**: 何をどう作ったか
- **転**: 実装や実機で見つかった「想定外」
- **結**: 結果と学び

### 開発の進め方（AI との役割分担）

このプロジェクトは、次の役割で進めました。

| 役割 | 担当 | やること |
|---|---|---|
| 判断・承認・実機操作 | 開発者（本人） | 方針の決定、実機の確認、ブラウザでのログイン |
| 設計・レビュー | Claude Code | タスクの設計、指示書の作成、完成物の検証 |
| 実装 | Kilo Code | 指示書に従った実装、作業報告書（Work_Report）の作成 |

- 各 Task には**指示書**（[task/](task/)）があり、完了後に**作業報告書**（[workReport/](workReport/)）が残ります
- 並列にできる Task は、`git worktree` で別のフォルダに分けて同時に進めました
- 実装は**テストが先**（Red → Green）。完了は、CI が通ったことで確認しました
- 実機に書き込む操作は、段階を分けて、開発者の承認を取りながら進めました

---

## 4. Phase 0 — 雛形を作り、API の癖を知る

### 5W1H サマリ

| 問い | 答え |
|---|---|
| When（いつ） | 2026-10-08 |
| Who（誰が） | Claude Code が雛形と調査スクリプトを作成し、開発者が確認 |
| What（何を） | プロジェクトの雛形・`.gitignore`・README の作成と、NHK 一覧 API の実調査 |
| Why（なぜ） | 実装の前に「API が本当に何を返すのか」を知らないと、設計が空想になるから |
| Where（どこで） | `scripts/survey.js` → `out/survey_raw.json` |
| How（どうやって） | 一覧 API の先頭 3 ページと最古側 3 ページを取得し、生の JSON を保存して集計した |

### 起 — なぜいきなり実装しなかったのか

「ラジオの選曲を Spotify に同期したい」を実現するには、まず**元データがどこまで取れるのか**を知る必要がありました。
NHK の番組 API は公式ドキュメントが見当たらず、実際にリクエストしてみないと分からないことが多いためです。
そこで、本実装の前に、調査専用のスクリプト `scripts/survey.js`（`npm run survey`）だけを用意しました。

### 承 — 何を調査し、どう実装したか

一覧 API に対して、先頭 3 ページ（新しい回）と、最古側の 3 ページを取得し、`out/survey_raw.json` に保存しました。

```
https://api.nhk.jp/r8/l/radioepisode/pl/series-rep-Z9WGYY3GP5.json?offset=0
```

- 1 ページ 10 件で、`nextUrl` を辿るページング方式です
- 全件数は `count` フィールドで分かります
- リクエストの間は 1 秒以上空けました（サーバーへの配慮）

### 転 — 調査で見えた「想定外」

調査の結果、単純な「全回の選曲リスト」ではないことが分かりました。

- 全エピソード数は **1662 回**（2026-10-08 時点。2020 年 1 月以降の放送分）
- 最新側のページでは、`musicList` に曲が入っている回と、**空配列の回**（まだ放送されていない未来の回）が混ざっていた
- 最古側の 3 ページ（計 22 回）は、`detailedRecentEvent.misc` というオブジェクト自体が存在しなかった（空配列ですらない）

「古い回には選曲データがないかもしれない」という疑いが、この調査で生まれました。
どこまで遡れるのかは、次の Phase の全件取得と、単体 API の追加調査で確定しました（→ Phase 1）。

### 結 — この Phase で得たもの

- 生の JSON をそのまま保存しておく調査スクリプトの型（後から何度でも再分析できます）
- 「曲がある回」「空の回」「フィールド自体がない回」の **3 種類を区別する**という設計方針
- Node.js の `fetch`・`JSON.parse`・`fs` の基本

> 対応するコード: [scripts/survey.js](scripts/survey.js)

---

## 5. Phase 1 — fetch の実装（キャッシュ・sleep・正規化・duration 変換）

### 5W1H サマリ

| 問い | 答え |
|---|---|
| When | 2026-10-08（Task 1A、1A の修正、1C） |
| Who | Kilo Code が実装し、Claude Code がレビュー |
| What | `fetch` コマンド（キャッシュ・sleep・リトライ付き）と、正規化・duration 変換のユニットテスト |
| Why | 手で API を何度も叩くのはサーバーの負担になり、再実行のたびに全件を取り直すのは非効率だから |
| Where | `src/nhk/**`、`src/index.js`、`test/nhk/**` |
| How | テストを先に書いて失敗させ（Red）、実装して通す（Green）。実機でも 2 回実行して増分動作を確認 |

### 起 — なぜ「キャッシュ・sleep・正規化」が必須だったか

Phase 0 で分かった制約が、そのまま実装の要件になりました。

- 全 1662 回を取得するには **167 リクエスト**が必要 → 連続で叩くとサーバーの負担になる → **1.2 秒の sleep** を挟む
- 途中で失敗したら最初からやり直し、では非効率 → **ページごとにキャッシュへ保存**する
- 曲名に全角英数（`ｔｏｍａｔｏ`）や連続した空白が混ざっている → **NFKC 正規化**してから検索に使う
- Spotify の曲の長さと比べるには秒数が必要 → ISO 8601 の `PT4M54S` を**秒に変換**する

### 承 — 何をどう作ったか

`src/nhk/client.js` の `fetchAllEpisodes()` に、次の動作を入れました。

1. `?offset=0` から `nextUrl` を辿って、全ページを取得する
2. リクエストの間に 1.2 秒 sleep する（1 秒未満を指定するとエラー）
3. HTTP エラーは指数バックオフ（1 秒 → 2 秒 → 4 秒）で最大 3 回リトライする。429 は `Retry-After` ヘッダーに従う。404 などの 4xx は、リトライしても無意味なので、すぐに例外にする
4. ページごとに `data/episodes.json` へ**原子的に**保存する（一時ファイルに書いてから名前を変える）
5. 全ページを辿り終えたときだけ、キャッシュに `complete: true` を記録する。次回は、前回完走していて、先頭ページの全件が「曲ありでキャッシュ済み」になった時点で、取得を打ち切る（増分実行）

正規化は `src/nhk/normalize.js` にまとめました。

- `normalizeText()`: NFKC 正規化 → 前後の trim → 連続した空白を 1 つに（`ｔｏｍａｔｏ` が `tomato` になります）
- `makeTrackKey()`: `title|artist` を正規化・小文字化した、重複を判定するキー（Phase 4 まで使い続けます）
- `extractTracks()`: 1 つのエピソードから曲の配列を取り出す純粋関数
- `parseIsoDuration()`（`duration.js`）: `PT4M54S` → `294`（不正な値は `null`）

### 転 — 実装中・実機で見つかった問題

- **再開バグ**: 最初の実装は、「ページ全件がキャッシュ済み」になれば取得を打ち切る、というものでした。すると、初回の全件取得が途中で止まった場合、再実行しても 2 ページ目で打ち切られてしまい、残りが永久に取得されません。「中断しても続きから再開できる」という Work_Report の記述が、実は誤りでした。レビューで指摘され、`complete` フラグを導入して直しました（回帰テストを先に書いて Red を確認）
- **時差の罠**: 放送日時は JST（+09:00）ですが、`Date` の内部は UTC です。`2026-09-30T15:00:00Z` は、JST では 10 月 1 日です。月別のグルーピングには、「9 時間足してから UTC として読む」という方法を使いました（`src/sync/plan.js`）
- **未来の回**: 未放送の回は `musicList: []` です。放送後に埋まるので、「曲を持つ回だけを対象にする」ルールにしました（放送後に、自動的に対象になります）
- **文字化け**: PowerShell の `Get-Content | Set-Content` でファイルを書き換えると、UTF-8 の日本語が壊れました。以後、「ファイルの編集はエディタか node で行う」ことをルールにしました

### 結 — 結果と学び

全件取得の結果（2026-10-08 時点）は、次のとおりです。

| 区分 | 回数 |
|---|---|
| 全エピソード | 1662 |
| 曲が入っている回 | 22（計 87 曲） |
| `musicList` が空の回（未放送） | 6 |
| `musicList` のフィールド自体がない回 | 1634 |

- `musicList` を持つのは **2026-09-08 以降の 28 回**だけでした
- 単体取得 API（`/r8/t/radioepisode/re/{id}.json`）も、年代を散らした 5 件で調べ、全文検索で確認しました。過去の回には選曲データがありませんでした（Task 1C）
- **「全期間の選曲を取得する」という当初の狙いは、API の仕様上できません。** そこで、「公開されている回を増分で同期する」ツールに方針を変えました。プレイリストは、放送月ごとに 1 つ作ります
- **学び**: 外部 API を扱うコードは、「sleep・リトライ・キャッシュ」の 3 点セットがあれば、たいてい堅牢になります。さらに `fetch` と `sleep` を引数で差し替えられる設計にしておくと、テストが実通信なしで、一瞬で終わります

> 対応するコード: [src/nhk/](src/nhk/)、[src/index.js](src/index.js)（`fetch` の部分）
> 記録: [1A](workReport/2026-10-08_task_1A_nhk_fetch.md) / [1C](workReport/2026-10-08_task_1C_survey.md)

---

## 6. Phase 2 — Spotify 認証（PKCE）

### 5W1H サマリ

| 問い | 答え |
|---|---|
| When | 2026-10-08（Task 1B） |
| Who | Kilo Code が実装し、開発者がブラウザでログイン |
| What | PKCE 方式の OAuth 認証。ブラウザでログインして、自分のユーザー情報が取れるところまで |
| Why | プレイリストを操作するには、ユーザーの認可が必要だから。さらに、クライアントシークレットを持たない方式にしたいから |
| Where | `src/spotify/{pkce,auth,tokenStore,client}.js`、`scripts/auth_check.js` |
| How | 公式ドキュメントで仕様を確認 → テストを先に書いて実装 → 実機でログインして `GET /me` を確認 |

### 起 — なぜ PKCE なのか

Spotify の Web API には複数の認可方式がありますが、**Authorization Code + PKCE** を選びました。

- クライアントシークレットが不要です。リポジトリや `.env` に載せる秘密が 1 つ減ります（ただし、トークンのファイルは別に守る必要があります）
- 個人ツールなので、「ブラウザでログインし、ローカルのサーバーがコールバックを受け取る」流れが自然です
- 公式ドキュメントに、この方式の手順が載っています

### 承 — 何をどう作ったか

認証の全体の流れです。

```
(1) node:crypto で code_verifier（43〜128文字のランダム文字列）と
    code_challenge（SHA256 → base64url）を生成する
(2) ブラウザで https://accounts.spotify.com/authorize?...&code_challenge_method=S256&... を開く
(3) ユーザーがログインして許可すると、http://127.0.0.1:8888/callback?code=...&state=... に戻される
(4) src/spotify/auth.js の startCallbackServer() が code を受け取る
    （state の不一致・エラー・タイムアウトは拒否し、1 回受け取ったらサーバーを閉じる）
(5) https://accounts.spotify.com/api/token に、code と code_verifier と client_id を送る
    （PKCE では、Basic 認証のヘッダーではなく、本文に client_id を入れる）
(6) access_token と refresh_token を data/spotify_token.json に保存する
```

`scripts/auth_check.js` を実行すると、この流れがすべて動きます。最後に `GET /me` を呼び、表示名と ID を表示します。

### 転 — 調査で判明した 2026 年の仕様変更

実装の前に公式ドキュメントを確認すると、2026 年 2 月の Dev Mode の変更で、次のことが分かりました。

- `GET /me` から `country`・`email`・`product` などのフィールドが**削除される**ことになった。実機でも、`product` は取得できなかった（コードは「ない場合の表示」に対応済み）
- `refresh_token` には約 6 ヶ月の寿命がある。失効したら再認証が必要
- トークンを更新したときの応答に、新しい `refresh_token` が**含まれない場合は、古い値を使い続ける**仕様。保存するときに、古い値を引き継ぐ実装にした
- リダイレクト先は、`localhost` ではなく **`127.0.0.1`** で登録する必要がある
- Dev Mode は、アプリの所有者が Premium であることが必要で、使えるユーザーは 5 人まで

### 結 — 結果と学び

- ブラウザでのログイン → トークンの保存 → `GET /me` でユーザー情報の表示、まで成功しました
- 2 回目以降は、ブラウザが開かず、保存したトークンですぐに成功します
- **学び**: OAuth をライブラリに任せきりにすると、中で何が起きているか分からなくなります。標準モジュールだけで書くと、state の検証（CSRF 対策）、スコープ、トークンの寿命が、手に取るように分かります

> 対応するコード: [src/spotify/pkce.js](src/spotify/pkce.js)、[auth.js](src/spotify/auth.js)、[tokenStore.js](src/spotify/tokenStore.js)
> 記録: [1B](workReport/2026-10-08_task_1B_spotify_auth.md)

---

## 7. Phase 3 — 検索マッチング（dry-run で直近 20 回を検証）

### 5W1H サマリ

| 問い | 答え |
|---|---|
| When | 2026-10-09（Task 3A / 3B / 3C） |
| Who | Kilo Code（3A と 3B は並列で実装）、Claude Code（設計・レビュー）、開発者（採否の判断） |
| What | Spotify の検索ラッパ、配点による採用の判定、`sync --dry-run` の結合。直近 20 回でマッチ率を検証 |
| Why | 書き込みの前に、「どれだけ正しくマッチするか」「危険な誤マッチはないか」を、数字で把握するため |
| Where | `src/match/**`、`src/spotify/search.js`、`src/sync/{plan,runMatch,report}.js` |
| How | 採点は配点表（定数）で決める。書き込む前に dry-run で結果を出し、人間が確認する |

### 起 — なぜ「採点」が必要か

NHK の曲名・アーティスト名の表記と、Spotify に登録された名前は、完全には一致しません。

- 全角英数: NHK「ｔｏｍａｔｏ」と Spotify「tomato」（NFKC で吸収できる）
- ローマ字表記: NHK「超ときめき♡宣伝部」と Spotify「Cho Tokimeki Sendenbu」（**表記の揺れでは吸収できない**）
- 曲名の副題: 「心配無用節 -無添加-」のような、括弧やハイフンの部分

そこで、「曲名・アーティスト・再生時間」の 3 つの要素に配点して、合計が閾値（60 点）以上の候補だけを採用する、**決定論的な採点方式**にしました。AI や確率に任せず、ルールで決めることで、「なぜこの曲が選ばれたのか」を、いつでも説明できます。

### 承 — 何をどう作ったか

配点は、`src/match/score.js` の `WEIGHTS` という定数にまとめました。

| 要素 | 条件 | 配点 |
|---|---|---|
| 曲名 | 完全に一致（正規化後・小文字） | +50 |
| 曲名 | 部分的に一致（片方がもう片方を含む） | +25 |
| コア曲名 | 括弧と「 - 」以降を除いた曲名が完全に一致 | +40（曲名の配点は、高いほうだけ採用） |
| アーティスト | 完全に一致 | +40 |
| アーティスト | 部分的に一致 | +20 |
| 再生時間 | 差が ±5 秒以内 | +10 |

検索は、`track:"曲名" artist:"アーティスト"` という、フィールドを指定する構文を使います（`src/spotify/search.js` の `buildQuery`）。検索結果の上限は、2026 年 2 月の変更で 10 件になっています。候補が 0 件のときは、アーティストを除いて再検索します（`searchWithFallback`）。

3A（採点）と 3B（検索）は、互いに独立しているので、別々の worktree で並列に実装しました。両者をつなぐ「候補の形」（`{ id, uri, title, artists, durationSec }`）だけを、先に決めておきました。

### 転 — dry-run で見えた現実

`sync --dry-run --limit 20`（直近 20 回・58 曲）の結果です。

- マッチ率 **96.6%**（56/58）。未マッチは 2 曲
- **アーティストの点が 0 のまま採用された曲が 11 件**。すべて、ちょうど 60 点（曲名が完全一致の 50 点 + 再生時間の 10 点）でした。原因は、Spotify がアーティスト名をローマ字で返すことです（超ときめき♡宣伝部 → Cho Tokimeki Sendenbu）
- 曲名が部分一致だけでの誤採用は **0 件**でした（「Love」と「Love Story」のような取り違えは、懸念されましたが、起きませんでした）
- 未マッチの 2 曲は、どちらも正しい曲が候補にありました。1 曲は、副題のハイフンの書き方が違う「心配無用節 -無添加-」、もう 1 曲は、NHK 側の曲名のタイプミスでした

ここで、開発者が判断しました。**「採点ルールは変更しない」**（閾値は 60 のまま）。誤採用がなく、ルールを複雑にするほうがリスクが大きいと考えたためです。この判断は、指示書の「起点」欄に記録しています。

### 結 — 結果と学び

- 直近 20 回の結果を CSV（`out/unmatched.csv` と `out/matched_preview.csv`。Excel で開けるよう BOM 付き）に出力しました
- **学び**: 書き込みをする機能は、「dry-run で数字を出し、人間が判断する」工程を挟むと、不安なまま本番に進まなくて済みます。判断の材料（内訳の表や一覧）を出すコードも、製品のコードの一部です

> 対応するコード: [src/match/](src/match/)、[src/spotify/search.js](src/spotify/search.js)、[src/sync/](src/sync/)
> 記録: [3A](workReport/2026-10-09_task_3A_matching_logic.md) / [3B](workReport/2026-10-09_task_3B_spotify_search.md) / [3C](workReport/2026-10-09_task_3C_sync_dry_run.md)

---

## 8. セットアップ

### 8-1. 前提

- Node.js 20 以上（外部パッケージは不要なので、`npm install` は要りません）
- Spotify のアカウントと、[Spotify for Developers](https://developer.spotify.com/dashboard) で作るアプリ
  - **Redirect URI** に `http://127.0.0.1:8888/callback` を登録します（`localhost` ではなく `127.0.0.1`）
  - Dev Mode のアプリでは、所有者が **Premium** である必要があります（2026 年 2 月時点）
- NHK の API は、公開されていますが、公式にドキュメントされたものではありません。負荷をかけないよう、sleep とキャッシュを内蔵しています

### 8-2. 手順

PowerShell（Windows）の例です。macOS / Linux では、`Copy-Item` を `cp` に置き換えてください。

```powershell
# 1. .env を作る（Spotify ダッシュボードの Client ID を設定する）
Copy-Item .env.example .env
#   SPOTIFY_CLIENT_ID=<あなたの Client ID>
#   SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback

# 2. Spotify の認証（ブラウザが開きます。初回のみ）
node scripts/auth_check.js

# 3. NHK からエピソードを取得する（初回は約 167 リクエスト・数分。2 回目以降は増分）
node src/index.js fetch

# 4. dry-run でマッチングの結果を確認する（書き込みません）
node src/index.js sync --dry-run --limit 20

# 5. 書き込む（計画を表示 → [y/N] の確認 → 月別プレイリストを作成・追記）
node src/index.js sync --limit 20
node src/index.js sync            # 全件。2 回目以降は、追加 0 件で終わる（冪等）
```

### 8-3. 主なオプション

| オプション | 意味 |
|---|---|
| `--dry-run` | 書き込まず、結果のレポートと CSV（`out/`）だけを出力する |
| `--since YYYY-MM-DD` | 放送日（JST）が指定した日以降の回だけを対象にする |
| `--limit N` | 新しい順に N 回だけを対象にする（処理済みの回も数えます） |
| `--include-theme` | テーマ曲（NEW POINT / 西岡大貴）も対象にする（既定は除外） |
| `--min-score N` | 採用するスコアの閾値（既定は 60） |
| `--yes` | 書き込む前の確認を省略する |

### 8-4. 生成されるファイル（すべて `.gitignore` 済み）

| ファイル | 内容 |
|---|---|
| `data/episodes.json` | NHK のエピソードのキャッシュ（増分で更新） |
| `data/spotify_token.json` | Spotify のトークン（自動で更新） |
| `data/state.json` | 処理済みの回・追加済みの曲・月別プレイリストの ID |
| `out/unmatched.csv` / `out/matched_preview.csv` | dry-run の結果レポート |

> **注意:** `data/` の中のファイルは、実行したフォルダに作られます。`git worktree` で別のフォルダを作って作業する場合は、実機で動かすフォルダ（`data/` があるフォルダ）を決めておいてください。`data/state.json` を失うと、同じ名前のプレイリストが、もう 1 つ作られてしまいます。

---

## 9. 動かした結果（Phase 4 の実機）と運用

### 5W1H サマリ

| 問い | 答え |
|---|---|
| When | 2026-10-10（Task 4A / 4B / 4C） |
| Who | Kilo Code（4A と 4B は並列）。**実機への書き込みは、各段階で開発者が承認してから実行** |
| What | プレイリストの作成・追加の API ラッパ、`data/state.json`（処理済みの記録）、`sync` の書き込みモード |
| Why | 何度実行しても、曲が二重に追加されない「冪等」な同期を実現するため |
| Where | `src/sync/apply.js`、`src/sync/state.js`、`src/spotify/playlist.js`、`src/index.js` |
| How | dry-run → 承認 → `--limit 3` → 目視確認 → 再実行で追加 0 件 → `--limit 20` → 全件、と段階的に拡大 |

### 起 — なぜ state.json と「段階的な拡大」が必要か

Spotify への書き込みは、取り消しが面倒です（削除の API は、このプロジェクトでは使わない、と決めました）。そのため、2 つの安全装置を設計しました。

1. **state.json**: 処理済みの回、追加済みの曲（`makeTrackKey`）、月別プレイリストの ID を記録します。更新関数は、すべて新しい state を返す純粋関数です。壊れた JSON は例外にして、自動では上書きしません（データを失わないため）
2. **段階的な拡大**: dry-run → 承認 → `--limit 3`（最初は 3 回分だけ）→ Spotify のアプリで目視確認 → 再実行して追加 0 件を確認（冪等） → `--limit 20` → 全件

なお、当初の計画にあった「全期間への拡大」は、Phase 1 で分かった API の制約により、「選曲が公開されている回すべて」に読み替えました。

### 承 — 何をどう作ったか

書き込みの本体 `src/sync/apply.js` の流れです。

1. 処理済みの回を、対象から外す（`isEpisodeProcessed`）
2. 追加済みの曲は、検索しない（`hasTrack` により、検索 API の呼び出しを節約）
3. 検索と採点（既存の `runMatch`。読み取りのみ）
4. 月ごとに、プレイリストがなければ作成する（`POST /me/playlists`）→ **直後に state を保存**
5. `listPlaylistUris` で**実際のプレイリストの内容を読み直し**、重複を除いてから、100 件ずつ追加する（`addTrackUris`）
6. 追加した後にも、もう一度読み直し、**実際に入った曲だけ**を state に記録する（「真実は Spotify 側」の原則）
7. 回の処理が終わったら、処理済みにして（`markEpisode`）、未マッチの曲も記録する（`recordUnmatched`）

### 転 — 実機で見つかった 2 つのバグと、Spotify の癖

実機でのテストは、ユニットテストでは見えなかった問題を、掘り起こしました。

1. **処理済みの範囲のバグ**: 処理済みの記録が、「今回選んだ回」ではなく、**キャッシュの全件（1662 回）**に及んでいました。`--limit` で選ばなかった回や、未放送の回までが「処理済み」になり、以後、永遠に同期されなくなる重大なバグです。state.json の中身を見ていたので、気づけました（回帰テストを追加 → 修正 → 実機の state も修復）
2. **`--limit` の解釈**: 最初の実装は「未処理の回から N 回」でした。そのため、同じコマンドを再実行すると、次のバッチを追加してしまい、「追加 0 件」の確認に失敗しました。「新しい順に N 回を選ぶ（処理済みを含む）→ 処理済みを除く」という順序に直して、冪等になりました
3. **Spotify の癖**: `POST /me/playlists` に `public: false` を指定しても、今回の環境では、公開のプレイリストとして作成されました。リクエストの本文の捕捉と、`GET /playlists/{id}` での確認で、「こちらの要求は正しく、Spotify 側の挙動である」と分かりました。個人の選曲リストなので、開発者が「公開のままで構わない」と判断しました

### 結 — 結果と学び

実機の最終結果（2026-10-10 の初回の同期。Spotify の API で確認し、state.json と完全に一致）です。

| プレイリスト | 曲数 |
|---|---|
| ミュージックライン 2026-10 | 15 曲 |
| ミュージックライン 2026-09 | 48 曲 |
| **合計** | **63 曲** |

最後の再実行では、追加が 0 件で、22 回すべてが処理済みとしてスキップされました。

その後の運用は、**`fetch` → `sync` を実行するだけ**です。新しく放送され、選曲が公開された回だけが、月別のプレイリストに追記されます。

- **学び**: 冪等性は、「追加する前に確認する」だけでは足りません。「処理済みの記録を、どの順序で適用するか」まで設計に含めます。そして、外部のサービスに対する操作では、自分の記録より、**相手側の実際の状態**を信じます

> 対応するコード: [src/sync/apply.js](src/sync/apply.js)、[state.js](src/sync/state.js)、[src/spotify/playlist.js](src/spotify/playlist.js)
> 記録: [4A](workReport/2026-10-10_task_4A_playlist_api.md) / [4B](workReport/2026-10-10_task_4B_state_store.md) / [4C](workReport/2026-10-10_task_4C_sync_write.md)

### 運用: 週に 1 回、新着を取り込む

番組は月〜金に放送されるので、週に 1 回、次の順に実行します。

```powershell
node src/index.js fetch
node src/index.js sync --dry-run   # 追加予定を確認する
node src/index.js sync             # [y/N] で確認して書き込む
```

- 未マッチの曲は `data/state.json` と `out/unmatched.csv` に記録されます。手動で Spotify に追加するかは、あなたが決めます
- Spotify の `refresh_token` は、約 6 ヶ月で失効します。失効したら、`data/spotify_token.json` を削除して、`node scripts/auth_check.js` を実行し、再認証してください
- この週次の実行は、自動化できます（次の「10. Phase 5」を参照）

---

## 10. Phase 5 — 週次の自動実行とワンクリック実行

### 5W1H サマリ

| 問い | 答え |
|---|---|
| When | 2026-10-10（Task 5A） |
| Who | Kilo Code が実装し、Claude Code がレビュー。登録は開発者が承認して実行 |
| What | 週次の自動実行（Windows のタスクスケジューラ）と、ダブルクリックで動くショートカット |
| Why | 毎週のコマンドを、忘れずに、手間なく実行するため |
| Where | `src/ops/weekly.js`、`scripts/weekly_sync.js`、`scripts/sync_now.bat`、`scripts/register_weekly_task.ps1` |
| How | `fetch` → `sync` を子プロセスで実行し、ログを残す。書き込みには安全装置（上限）を付けた |

### 起 — 自動化で心配になること

人の目が届かないところで、Spotify に書き込むプログラムが動きます。そこで、「うっかり大量に書き込まない」「同じ処理が重ならない」「失敗したときに気づける」の 3 つを設計の中心にしました。

### 承 — 何をどう作ったか

- **安全装置 `--max-add N`**: 追加予定の曲数が N を超えるときは、**1 曲も書き込まずに**終了コード 2 で止まります。無人の実行では 50 を指定します
- **二重起動の防止**: `data/weekly.lock`。6 時間より古いロックは、残骸として無視します
- **ログ**: `logs/weekly_YYYY-MM-DD_HHmmss.log`（JST。60 日で自動削除）と、最新の結果の `logs/last_run.txt`
- **失敗の案内**: Spotify の認証が失効したときは再認証の手順を、一時的なエラーのときは「次回の実行で再試行される」ことを表示します
- **副作用の注入**: プロセスの起動、ファイル、時刻は、引数で差し替えられます。テストでは、実際のプロセスを起動しません

### 転 — 作る途中で見つかった問題

- テストが、Windows 前提の文字列で URL を組み立てていたため、CI（Linux）でだけ失敗しました。`pathToFileURL` を使う形に直しました。**手元（Windows）だけでテストが通っても、CI は別の環境で動く**という例です
- PowerShell 5.1 は、BOM のない UTF-8 のスクリプトを、日本語の文字コード（ANSI）として読みます。`.ps1` は **BOM 付き**の UTF-8 で保存する必要がありました

### 結 — 使い方

**週次の自動実行（Windows のタスクスケジューラ）**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register_weekly_task.ps1
```

- 毎週土曜 9:00 に、`fetch` → `sync --yes --max-add 50` を実行するタスク `MusiclineSpotifySync` を登録します（実行前に内容を表示して `[y/N]` で確認。PC が電源オフで時刻を逃した場合は、起動後すぐに実行されます）
- 曜日や時刻の変更: `-Day Monday -Time 08:00` のように指定します
- 登録内容だけを見る: `-PrintPlan`（何も変更しません）
- 解除: `-Remove`

**ワンクリック実行**

`scripts\sync_now.bat` をダブルクリックします（`register_weekly_task.ps1 -DesktopShortcut` で、デスクトップにショートカットを作れます）。`fetch` → `sync --dry-run`（追加予定の表示）→ `sync`（`[y/N]` の確認あり）の順に実行し、最後までウィンドウが開いたままになります。

**ログと再認証**

- 最新の結果は `logs\last_run.txt`（成功か失敗か・日時・追加曲数・未マッチ数）で確認できます
- 「認証が失効しています」と出たときは、`node scripts/auth_check.js` を実行して再認証します

- **学び**: 無人で動く処理には、「止まる条件」（上限、ロック）と「記録」（ログ、最新の結果）を、機能と同じ重さで設計します

> 対応するコード: [src/ops/weekly.js](src/ops/weekly.js)、[scripts/](scripts/)
> 記録: [5A](workReport/2026-10-10_task_5A_weekly_automation.md)・指示書 [task/task_5A_weekly_automation.md](task/task_5A_weekly_automation.md)

---

## 11. フォークして作り変える

Phase 0〜4 のコードは、独立したモジュールに分かれているので、1 か所だけを変えても動きます。

### 11-1. 最短で「別の番組」に変える

| 変えるもの | 場所 |
|---|---|
| 取得する番組（API の URL） | `src/nhk/client.js` の `BASE_URL`（`series-rep-...` の部分） |
| 除外するテーマ曲の条件 | `src/match/theme.js` |
| プレイリスト名の接頭辞 | `src/sync/apply.js` の `PLAYLIST_NAME_PREFIX`（日本語は `\uXXXX` で書かれています） |
| 月ごとのまとめ方（年単位にするなど） | `src/sync/plan.js` の月のグルーピング |
| 採点の配点・閾値 | `src/match/score.js` の `WEIGHTS`、`src/match/pickBest.js` の `MIN_SCORE_DEFAULT` |

### 11-2. 改変のアイデア（易しい順）

| アイデア | 触る場所 | 学べること |
|---|---|---|
| テーマ曲の判定条件を変える | `src/match/theme.js` | 条件の組み立てとテスト |
| 未マッチ曲の CSV に、検索に使った語句の列を足す | `src/sync/report.js` | CSV の設計とエスケープ |
| 週次で自動実行する（`cron` やタスクスケジューラ） | `scripts/`（Phase 5 を参照） | 無人実行の安全装置 |
| 別のラジオ番組・別の API に対応する | `src/nhk/client.js` を、差し替えられるモジュールにする | 差し替え可能な設計 |
| プレイリストの名前の規則を変える（年度ごとなど） | `src/sync/plan.js`、`src/sync/apply.js` | グルーピングと state の設計 |
| 曲名の類似度（レーベンシュタイン距離）を加点する | `src/match/score.js` | アルゴリズムの実装とテスト |

### 11-3. フォークするときの注意

- **自分の Spotify アプリ**を、ダッシュボードで作ってください（Client ID は、あなた自身のものを `.env` に書きます）
- `.env`、`data/spotify_token.json`、`data/state.json` は、**絶対にコミットしない**でください（`.gitignore` 済みです）。`state.json` には、プレイリストの ID が入っています
- 変更するときは、**テストを先に書いて**（Red）から、実装する（Green）と、壊したときにすぐ気づけます
- Spotify への書き込みを変えるときは、まず `--dry-run` で、結果を確かめてください

---

## 12. テストと CI

```powershell
node --test        # 201 件が走ります（2026-10-11 時点。fail 0 / skip 0）
```

- すべて `node:test`（Node.js 組み込み）で書かれています。外部のテストライブラリは不要です
- 通信するコード（`fetch`・sleep・プレイリストの API）は、**すべて引数で差し替えられる**ので、ユニットテストは実際の通信なしで動きます
- CLI の動作は、子プロセスとして `node src/index.js` を起動して確かめています（`test/sync/cli.test.js`）
- CI（`.github/workflows/ci.yml`）は、push / PR のたびに `node --test` を実行するだけの最小構成です

テストの方針:

1. **テストを先に書く**（Red → Green）。失敗の出力は、作業報告書に残す
2. テストを弱めない（`assert` の削除・skip の追加・閾値の緩和は禁止）
3. 通信・時刻・sleep は、注入して、結果を決まったものにする
4. 日本語の文字列は、そのまま書いてよい。ただし、**PowerShell の `Get-Content | Set-Content` で、ファイルを書き換えない**（UTF-8 の日本語が壊れます）

---

## 13. 設計の決まりごと（コードを読むときの道しるべ）

| 原則 | 内容 | 実装 |
|---|---|---|
| 純粋関数を優先 | 更新系の関数は、入力を壊さず、新しい値を返す（テストが書きやすい） | `src/sync/state.js`、`src/match/**` |
| 真実は API 側 | 記録した state より、Spotify の実際の状態を信じる（追加した後は必ず読み直す） | `src/sync/apply.js` |
| 決定論的な採用 | マッチの判定は、配点表（定数）で説明できるようにする。AI や確率は使わない | `src/match/score.js` |
| 段階的な安全装置 | dry-run → 承認 → limit 3 → 目視 → 冪等の確認 → 拡大 | `src/index.js`、`src/sync/apply.js` |
| 原子的な書き込み | 一時ファイルに書いて名前を変える。中途半端なファイルを作らない | `src/nhk/client.js`、`src/spotify/tokenStore.js`、`src/sync/state.js` |
| サーバーへの配慮 | sleep・リトライ（指数バックオフと `Retry-After`）・増分取得 | `src/nhk/client.js`、`src/spotify/client.js` |

---

## 14. ドキュメント一覧

| 記録 | 内容 |
|---|---|
| [1A: NHK fetch](workReport/2026-10-08_task_1A_nhk_fetch.md) | Phase 1 の実装記録（Red / Green のログ、再開バグの訂正） |
| [1B: Spotify 認証](workReport/2026-10-08_task_1B_spotify_auth.md) | Phase 2 の実装記録（PKCE、2026 年の仕様変更の調査） |
| [1C: 過去回の調査](workReport/2026-10-08_task_1C_survey.md) | 単体取得 API の調査（過去回に選曲データがないことの裏付け） |
| [3A: マッチングのロジック](workReport/2026-10-09_task_3A_matching_logic.md) | 採点ロジックの設計とテスト |
| [3B: Spotify 検索](workReport/2026-10-09_task_3B_spotify_search.md) | 検索ラッパと、フィールド指定の構文の実機検証 |
| [3C: dry-run](workReport/2026-10-09_task_3C_sync_dry_run.md) | dry-run の結合、マッチ率 96.6%、リスクの分析 |
| [4A: プレイリスト API](workReport/2026-10-10_task_4A_playlist_api.md) | プレイリスト API のラッパ（2026 年 2 月の変更の確認） |
| [4B: state 管理](workReport/2026-10-10_task_4B_state_store.md) | state.json の設計（イミュータブル・壊れたファイルの保護） |
| [4C: 書き込み](workReport/2026-10-10_task_4C_sync_write.md) | 書き込みの結合、実機での 63 曲の同期、見つかったバグの記録 |
| [5A: 週次の自動実行](workReport/2026-10-10_task_5A_weekly_automation.md) | 週次の自動実行、ワンクリック実行、 の安全装置 |
| [task/](task/) | 各タスクの指示書（要件と受け入れ基準）、日々の進捗記録 |

---

## 15. 注意

- このツールは、**学習と個人利用**のためのものです。無保証です
- Spotify の開発者向けの規約（Dev Mode は 5 ユーザーまで、など）と、NHK の API への配慮（sleep・キャッシュ）を守って使ってください。NHK の API は、公式にドキュメントされたものではないので、予告なく変わる可能性があります
- トークン（`data/spotify_token.json`）と `.env` は、**絶対にコミットしないでください**（`.gitignore` 済みです）
- Spotify の仕様は変わります。2026 年 2 月の大きな変更の記録は、[1B の作業報告書](workReport/2026-10-08_task_1B_spotify_auth.md)の冒頭にあります
