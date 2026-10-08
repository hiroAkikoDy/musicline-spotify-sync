# Task 1B: Spotify 認証 PKCE（Phase 2）

- ブランチ / Worktree: `feat/1b-spotify-auth` / `../msync-wt-1b`
- セキュリティ分類: B（OAuthトークンを扱う）。追加要件: トークンを標準出力・ログに出さない、
  トークン保存ファイルは `.gitignore` 済みであること、ファイル権限は可能な範囲で本人のみ
- 進め方: **red/green TDD**。テスト先行→失敗確認（Red のログを Work_Report に貼る）→実装。
  テストを弱める変更は禁止。

## 事前調査（実装前に必須）
1. Spotify公式ドキュメントを確認（WebFetch/検索）:
   - February 2026 migration guide、November 2024 の変更点
   - Authorization Code with PKCE、Refresh token、`GET /me`
2. 確認結果（URL・要点・実装に影響する差異）を Work_Report の冒頭に記録する。
   既知の前提（要裏取り）: Client Secret は使わない / リダイレクトは `http://127.0.0.1:8888/callback`
   （localhost不可）/ `/playlists/{id}/tracks` → `/items` / 検索limit上限は小さい / audio-features等は使わない
3. 前提とドキュメントが食い違う場合は**実装を止めて報告**する（黙って辻褄を合わせない）

## Task boundary
- 新規: `src/spotify/pkce.js`, `src/spotify/auth.js`, `src/spotify/client.js`（薄い共通fetchラッパ）,
  `src/spotify/tokenStore.js`, `scripts/auth_check.js`, `test/spotify/*.test.js`
- 触らない: `src/nhk/**`, `src/index.js`（CLI統合は別タスクで行う）, 外部依存追加（dotenv のみ可。`.env` は読むが**中身を表示しない・書き換えない**）
- スコープ: `playlist-modify-private playlist-modify-public`

## 実装要件
1. `pkce.js`: `generateCodeVerifier()`（43〜128文字, unreserved文字のみ, `crypto.randomBytes`）、
   `codeChallengeS256(verifier)`（SHA256→base64url, パディングなし）、`generateState()`
2. `auth.js`:
   - `buildAuthorizeUrl({clientId, redirectUri, scopes, state, challenge})`
   - `startCallbackServer({port, path, expectedState, timeoutMs=120000})`: 127.0.0.1 のみにbind。
     state不一致は拒否、`error` パラメータはエラーとして返す、1回受けたら閉じる、タイムアウトあり
   - `exchangeCodeForToken(...)`, `refreshAccessToken(...)`（`fetchImpl` 注入可能）
   - ブラウザは `start`（Windows）/`open`/`xdg-open` で開く。開けなくてもURLを表示して待機できること
3. `tokenStore.js`: `data/spotify_token.json` に `{access_token, refresh_token, expires_at, scope}` を保存/読込。
   期限60秒前なら自動refresh。refresh応答に新refresh_tokenが無ければ旧を保持
4. `client.js`: `spotifyFetch(path, opts)` — Bearer付与、401で1回だけrefresh再試行、
   **429は `Retry-After` 秒だけ待って再試行**（最大5回）、その他エラーは本文を含めて例外
5. `scripts/auth_check.js`: 未ログインならブラウザ認証→トークン保存→`GET /me` を呼び
   `display_name` / `id` / `product` のみ表示（トークンは出さない）。2回目以降は保存トークンで即成功

## テスト（先に書く）
- PKCE: verifierの長さ・文字種、RFC 7636 付録Bのテストベクトルで challenge 一致、state の一意性
- buildAuthorizeUrl: 必須クエリ（response_type=code, code_challenge_method=S256 等）
- コールバックサーバー: 正常 / state不一致 / error付き / タイムアウト（短いtimeoutで）／127.0.0.1以外にbindしない
- トークン交換・refresh: `fetchImpl` モック。期限切れ判定、refresh_token保持
- spotifyFetch: 401→refresh→再試行、429→Retry-After待機（sleep注入でテスト）、5回超で例外
- **実Spotifyへの通信はユニットテストで行わない**

## 完了条件
- `node --test` 全件通過（ログ貼付）
- 実機確認: `node scripts/auth_check.js` でログイン → 「自分のユーザー情報が取れた」出力（display_name/id/product）。
  2回目実行でブラウザが開かず成功すること。出力・ログ・Work_Report にトークンが含まれないこと（`grep` で確認し結果を記載）
- `git status` で `.env` と `data/spotify_token.json` が追跡対象外であることを確認
- `node -e` で `codeChallengeS256` の既知ベクトル確認結果を記録
- コミット → **push** → CIグリーン確認
- Work_Report を `workReport/` に作成。「起点」欄: `起点：計画/Phase2-1B/採用`。「動作確認結果」に未実施を残さない
- 実機ログインにユーザー操作が必要なため、その時点で一度止まって依頼すること（勝手に「確認済み」と書かない）
