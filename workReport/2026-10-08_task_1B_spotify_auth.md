<!-- precedent_id: (ingest側で付与)
     source_type: experience
     report_schema: v2
     project: musicline-spotify-sync
     tags: spotify,oauth,pkce,tdd,node,phase2 -->
### 完了報告：Task 1B: Spotify 認証 PKCE（Phase 2）
実施日時：2026-10-08（JST）
目標：Spotify Authorization Code + PKCE 認証（コールバックサーバー・トークン保存・自動refresh・
API共通ラッパ）を red/green TDD で実装し、ユニットテスト全件通過・CIグリーンまで確認する。
実機ログインはユーザー操作が必要なため、その時点で停止して依頼する。

## 事前調査（公式ドキュメントの裏取り）
実施日: 2026-10-08。以下を WebFetch で確認。

| ドキュメント | URL | 実装に影響する要点 |
|---|---|---|
| Authorization Code with PKCE Flow | developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow | verifier は43〜128文字・unreserved文字。challenge は SHA256→base64url(パディングなし)。/authorize に `code_challenge_method=S256` + `code_challenge` 必須。**トークン交換は body に client_id + code_verifier を載せ、Basic認証ヘッダは不要** |
| Authorization Code Flow | .../tutorials/code-flow | コールバックは `code`+`state` または `error`+`state`。state不一致はフロー中断。Spotify公式サンプル自体が `http://127.0.0.1:8888/callback` を使用(localhost不可の裏取り) |
| Refreshing tokens | .../tutorials/refreshing-tokens | refresh は `grant_type=refresh_token` + `refresh_token` + **client_id(PKCE のみ必須)**。**応答に新 refresh_token が無い場合は旧値を使い続ける**(タスク要件と一致)。refresh_token の寿命は6ヶ月。`invalid_grant` は再試行せず再認証 |
| February 2026 Dev Mode Changes | .../tutorials/february-2026-migration-guide | `/playlists/{id}/tracks` → `/items` へ改名(前提どおり)。**検索 limit 最大10・デフォルト5**(前提どおり)。Dev Mode はオーナーに Premium 必須・ユーザー5人まで |
| GET /me リファレンス | .../reference/get-current-users-profile | **`product` は Deprecated**。Feb 2026 移行ガイドでは Dev Mode アプリの `GET /me` から `country/email/explicit_content/followers/product` が削除対象と記載。新フィールド `account_id`(不変) 追加 |

### ⚠ 前提との差異(黙って辻褄合わせをしないための明示)
- タスクの表示要件「display_name / id / **product**」のうち、**`product` は Feb 2026 の Dev Mode 変更で
  削除対象フィールド**です(リファレンスには Deprecated として残存)。Dev Mode アプリでは取得できない
  可能性が高い。
- 対応: auth_check.js は `product` を表示試行し、無ければ
  `(取得できません - Feb 2026 Dev Mode 変更で product は削除対象フィールド)` と表示します
  (辻褄合わせの隠蔽ではなく、明示的なフォールバック)。**実機ログイン後に実際の応答を確認して
  ご判断ください**。フロー本体(PKCE・トークン)には影響しません。
- その他の前提(Client Secret不使用 / 127.0.0.1リダイレクト / tracks→items / 検索limit縮小 /
  audio-features等不使用)はすべて公式ドキュメントと一致しました。

## 変更ファイル一覧
作業場所: worktree `../msync-wt-1b`（ブランチ `feat/1b-spotify-auth`、ベース main 802e6d0）

| ファイル | 変更内容 | 行番号 |
|---|---|---|
| src/spotify/pkce.js | 新規。`generateCodeVerifier`(43-128文字・unreserved・バイアス除去), `codeChallengeS256`(SHA256→base64url), `generateState` | 1-31 |
| src/spotify/auth.js | 新規。`buildAuthorizeUrl`, `startCallbackServer`(127.0.0.1のみbind・state検証・error通知・1回で閉じる・タイムアウト), `exchangeCodeForToken`, `refreshAccessToken`, `openBrowser`(start/open/xdg-open・失敗時false) | 1-136 |
| src/spotify/tokenStore.js | 新規。`data/spotify_token.json` への保存/読込(原子的書き込み+chmod 0600)、期限60秒前の自動refresh、**新refresh_token無ければ旧値保持** | 1-60 |
| src/spotify/client.js | 新規。`createSpotifyClient`/`spotifyFetch`: Bearer付与、401→1回だけrefresh再試行、429→Retry-After待機再試行(最大5回)、他は本文付き例外 | 1-46 |
| scripts/auth_check.js | 新規。未ログイン→ブラウザ認証→保存→GET /me で display_name/id/product のみ表示。トークンは出力しない | 1-104 |
| test/spotify/pkce.test.js | 新規テスト（先に作成=Red） | 1-55 |
| test/spotify/auth.test.js | 新規テスト（先に作成=Red） | 1-122 |
| test/spotify/tokenStore.test.js | 新規テスト（先に作成=Red） | 1-88 |
| test/spotify/client.test.js | 新規テスト（先に作成=Red） | 1-92 |
| .github/workflows/ci.yml | 新規。1Aブランチと同一内容の `node --test` 最小構成（main には未存在のため、CIグリーンの完了条件を満たすために追加。1Aと同一内容なのでマージ時も衝突しない） | 1-13 |

Task boundary順守: `src/nhk/**`, `src/index.js` 未触。外部依存の追加なし（dotenv も不使用・.env は自前パース）。
実Spotifyへの通信はユニットテストで行っていない（コールバックサーバーのテストはループバック127.0.0.1のみ）。

## 発生したエラーと対処
| # | エラー内容 | 原因 | 対処法 |
|---|---|---|---|
| 1 | Red フェーズ: `ERR_MODULE_NOT_FOUND`（全4テストファイル） | 実装前（TDD の期待どおりの失敗） | Green で実装し解消 |
| 2 | `TypeError: res.text is not a function`（tokenStore テスト2件） | テストのモックが `res.text()` を実装していなかった(実 Response と不一致) | **テストのモック**に text() を追加（実装ではなくモックの不全。assert 内容の変更なし） |
| 3 | `cb.address()` が null（コールバックサーバーテスト） | `server.listen()` は非同期で、listen 完了前は address() が null | 実装に `ready` プロミス(listening完了で解決)を追加し、テストは `await cb.ready` 後に address を検証 |

## Git操作
- コミットメッセージ：`feat(1B): Spotify認証 PKCE (verifier/challenge・コールバックサーバー・トークン保存・APIラッパ・31テスト)`
- コミットID：f795908（feat/1b-spotify-auth）
- ブランチ：feat/1b-spotify-auth（worktree ../msync-wt-1b・main 802e6d0 ベース）
- push状況：完了（origin feat/1b-spotify-auth）
- CIステータス：**グリーン** — run 37762580940（`completed success`・25s）
  ※ main 単体には ci.yml が無いため 1B ブランチの CI で確認

## 動作確認結果
**unit test（node --test・実Spotify通信なし）:**
```
ℹ tests 31
ℹ suites 10
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10648.126
```
対象: PKCE 12件（RFC 7636 付録Bベクトル含む）/ buildAuthorizeUrl・コールバックサーバー 8件
（正常・state不一致・error付き・タイムアウト・127.0.0.1bind・1回で閉じる）/ トークン交換・refresh 3件 /
tokenStore 7件（期限切れ判定・refresh_token保持・原子的書き込み）/ spotifyFetch 6件
（401→refresh→再試行・429→Retry-After・5回超で例外・本文付き例外）

**エッジ確認（node -e 相当）:**
```
verifier  : dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
challenge : E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
expected  : E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
match     : true
generateCodeVerifier(64) length: 64 / charset ok: true
```

**トークン非出力の設計確認:**
- auth_check.js が標準出力に書くのは、ガイド用URL(authorize URL・トークンは含まない)と
  display_name/id/product のみ。トークン保存はファイル経由で内容を表示しない
- authorize URL には code_challenge は含まれるが verifier / トークンは含まれない

**実機ログイン1回目（ユーザー実行・2026-10-08）:**
```
Spotify認証を開始します...
ブラウザで認証してください。開かない場合は下のURLを手動で開いてください:
https://accounts.spotify.com/authorize?...（URL全体は client_id/state/challenge を含むため割愛）
トークンを data/spotify_token.json に保存しました (.gitignore済み・内容は表示しません)
--- Spotify ユーザー情報 (GET /me) ---
display_name: hiro-a-ki
id: m2oq9rlfzvswahzll80iu4eda
product: (取得できません - Feb 2026 Dev Mode 変更で product は削除対象フィールド)
```
→ ログイン・認可・トークン保存・`GET /me` まで成功。
**`product` は実際に応答に含まれず**、事前調査の「Feb 2026 Dev Mode 変更で削除対象」どおりだった
（フォールバック表示が機能。辻褄合わせではなく実態確認済み）。

**実機2回目（私が実行・保存済みトークンを使用）:**
```
保存済みトークンを使用します (data/spotify_token.json)
--- Spotify ユーザー情報 (GET /me) ---
display_name: hiro-a-ki
id: m2oq9rlfzvswahzll80iu4eda
product: (取得できません - Feb 2026 Dev Mode 変更で product は削除対象フィールド)
```
→ **ブラウザは開かず**保存トークンで即成功（増分動作を確認）。

**トークン非出力の grep 確認（実トークン値との照合）:**
```
access_token (307文字) : 実行出力=含まれない / Work_Report=含まれない
refresh_token (131文字) : 実行出力=含まれない / Work_Report=含まれない
```
検査方法: data/spotify_token.json の実値を読み込み、2回目実行の出力と本レポート全文を
`String.includes` で照合（値自体は表示しない）。加えて `git check-ignore -v` で
`.gitignore:5:data/*token*` が `data/spotify_token.json` に一致、worktree の `git status` は
クリーン（トークンファイルが追跡対象に現れない）ことを確認。

## 完了条件チェック
- [x] `node --test` 全件通過（31/31・ログ上記）
- [x] 実機: `node scripts/auth_check.js` でログイン→ユーザー情報表示（display_name: hiro-a-ki / id: m2oq9rlfzvswahzll80iu4eda / product: なし=Feb 2026仕様変更どおり）
- [x] 2回目実行でブラウザが開かず成功（保存トークンで即成功）
- [x] 出力・ログ・Work_Report にトークンが含まれないこと（実トークン値との grep 照合で確認・結果記載）
- [x] `git status` で `.env` と `data/spotify_token.json` が追跡対象外
      （`git check-ignore -v`: `.gitignore:1:.env` / `.gitignore:5:data/*token*` → data/spotify_token.json が一致）
- [x] `node -e` で codeChallengeS256 の既知ベクトル確認（上記・一致）
- [x] コミット → push → CIグリーン確認（run 37762580940）
- [x] Work_Report を workReport/ に作成。起点: 起点：計画/Phase2-1B/採用
- [x] 実機ログインの直前で停止してユーザーに依頼 → ユーザー実行後に本追記（2026-10-08）

## 車検結果（受け入れ基準と照合）
├── CIグリーン：○（run 37762580940 success）
├── node --test：全31件通過 [○]
├── セキュリティ（分類B）：[○]（下記セキュリティ確認参照）
├── 型アノテーション：[○]
└── テストを弱める変更なし：[○]（assert削除・skip・閾値緩和なし。#2/#3はテストまたは実装の不全修正）

## セキュリティ確認（分類B: OAuthトークン扱い）
├── トークンの標準出力・ログ出力：なし（auth_check は display_name/id/product のみ表示。
│   エラーメッセージもトークン本文を含まない。token endpoint のエラーは status と
│   error/error_description のみ）
├── トークン保存ファイルの .gitignore：済み（`data/*token*` が data/spotify_token.json に一致。
│   git check-ignore で確認済み。.env も .gitignore:1）
├── ファイル権限：saveToken で chmod 0600 を試行（Windowsでは権限モデルが異なるためベストエフォート。
│   NTFSではユーザープロファイル配下のため本人のみアクセス可能な環境）
├── 外部APIへの意図しない送信：なし（accounts.spotify.com と api.spotify.com への通信のみ。
│   unit test では実通信なし・コールバックは 127.0.0.1 ループバックのみ）
├── ハードコードされたシークレット：なし（Client Secret は使わない設計）
└── 入力値のバリデーション：実装済み（state不一致拒否・errorパラメータ拒否・
    127.0.0.1以外のredirect_uri拒否・verifier長バリデーション・タイムアウト）

## 学習ポイント・次のステップへの展望
- PKCE ではトークン交換・refresh とも Basic 認証ヘッダ不要（client_id を body に載せる）。
  混同しやすいので Phase 3 以降も注意
- refresh_token は6ヶ月で失効するため、約6ヶ月ごとに再認証が必要（invalid_grant 時の
  ガイドメッセージは実装済み）
- `GET /me` の `product` は Deprecated（Dev Mode では取得不可の可能性）。Phase 3 のプレイリスト
  作成には影響しないが、ユーザー情報表示系は `account_id`/`id`/`display_name` 中心にするのが安全
- コールバックサーバーのテストは port 0（OS割当）+ `ready` プロミスで安定化

## 起点
起点：計画/Phase2-1B/採用

## Claudeへの質問・相談事項
1. ~~実機ログインのお願い~~ → **実施済み**（2026-10-08、ユーザーがブラウザで認可・成功）。
2. ~~リダイレクトURIの登録確認~~ → 認可が成功したため登録済みと確認。
3. `product` は実際に取得できなかった（事前調査どおり）。Phase 3 のプレイリスト作成には影響なし。
   ユーザー情報表示は `account_id`/`id`/`display_name` 中心で問題ないと考えるが、ご意見があればください。
