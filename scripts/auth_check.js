#!/usr/bin/env node
// Spotify認証チェック: 未ログインならブラウザ認証 → トークン保存 → GET /me。
// 表示するのは display_name / id / product のみ。トークンは絶対に出力しない。
// 2回目以降は保存トークンで即成功(期限切れ間近なら自動refresh)。
import { readFile } from "node:fs/promises";
import { generateCodeVerifier, codeChallengeS256, generateState } from "../src/spotify/pkce.js";
import { buildAuthorizeUrl, startCallbackServer, exchangeCodeForToken, openBrowser } from "../src/spotify/auth.js";
import { loadToken, saveToken, getValidToken, forceRefresh, DEFAULT_TOKEN_PATH } from "../src/spotify/tokenStore.js";
import { createSpotifyClient } from "../src/spotify/client.js";

const SCOPES = ["playlist-modify-private", "playlist-modify-public"];

// .env を読む(内容は表示しない・書き換えない)
async function loadEnv(path = ".env") {
  const env = {};
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return env;
    throw err;
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function main() {
  const env = await loadEnv();
  const clientId = env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    console.error("SPOTIFY_CLIENT_ID が未設定です (.env を確認してください)。");
    process.exitCode = 1;
    return;
  }
  const redirectUri = env.SPOTIFY_REDIRECT_URI || "http://127.0.0.1:8888/callback";
  const u = new URL(redirectUri);
  if (u.hostname !== "127.0.0.1") {
    console.error(`redirect_uri のホストは 127.0.0.1 である必要があります (現在: ${u.hostname})。`);
    process.exitCode = 1;
    return;
  }

  let token = await loadToken(DEFAULT_TOKEN_PATH);
  if (token?.refresh_token) {
    console.log(`保存済みトークンを使用します (${DEFAULT_TOKEN_PATH})`);
    token = await getValidToken({ clientId, path: DEFAULT_TOKEN_PATH });
  } else {
    console.log("Spotify認証を開始します...");
    const verifier = generateCodeVerifier();
    const challenge = codeChallengeS256(verifier);
    const state = generateState();
    const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri, scopes: SCOPES, state, challenge });
    console.log("ブラウザで認証してください。開かない場合は下のURLを手動で開いてください:");
    console.log(authorizeUrl);
    if (!openBrowser(authorizeUrl)) {
      console.log("(自動でブラウザを開けませんでした。上のURLをブラウザで開いてください)");
    }
    const cb = startCallbackServer({ port: Number(u.port) || 80, path: u.pathname || "/callback", expectedState: state, timeoutMs: 120000 });
    let code;
    try {
      ({ code } = await cb.done);
    } catch (err) {
      console.error(`認証コールバック失敗: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    const resp = await exchangeCodeForToken({ clientId, redirectUri, code, verifier });
    token = {
      access_token: resp.access_token,
      refresh_token: resp.refresh_token,
      expires_at: Date.now() + (Number(resp.expires_in) || 0) * 1000,
      scope: resp.scope,
    };
    await saveToken(token, DEFAULT_TOKEN_PATH);
    console.log(`トークンを ${DEFAULT_TOKEN_PATH} に保存しました (.gitignore済み・内容は表示しません)`);
  }

  const spotifyFetch = createSpotifyClient({
    getToken: async () => (await getValidToken({ clientId, path: DEFAULT_TOKEN_PATH }))?.access_token,
    refreshToken: async () => (await forceRefresh({ clientId, path: DEFAULT_TOKEN_PATH })).access_token,
  });
  const me = await spotifyFetch("/me");
  console.log("--- Spotify ユーザー情報 (GET /me) ---");
  console.log(`display_name: ${me.display_name ?? "(なし)"}`);
  console.log(`id: ${me.id ?? "(なし)"}`);
  console.log(`product: ${me.product ?? "(取得できません - Feb 2026 Dev Mode 変更で product は削除対象フィールド)"}`);
}

main().catch((err) => {
  if (/invalid_grant/.test(err?.message ?? "")) {
    console.error("refresh_token が無効です (6ヶ月の有効期限切れ/失効)。data/spotify_token.json を削除して再実行してください。");
  } else {
    console.error(`エラー: ${err?.message ?? err}`);
  }
  process.exitCode = 1;
});
