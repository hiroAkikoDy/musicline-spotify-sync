// Spotify Authorization Code + PKCE フロー。
// https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
// - Client Secret は使わない(トークン交換は body の client_id + code_verifier)
// - リダイレクトは http://127.0.0.1 のみ(localhost不可)
import { spawn } from "node:child_process";
import { createServer } from "node:http";

export const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
export const TOKEN_URL = "https://accounts.spotify.com/api/token";

export function buildAuthorizeUrl({ clientId, redirectUri, scopes, state, challenge }) {
  const u = new URL(AUTHORIZE_URL);
  const p = u.searchParams;
  p.set("response_type", "code");
  p.set("client_id", clientId);
  p.set("scope", scopes.join(" "));
  p.set("redirect_uri", redirectUri);
  p.set("state", state);
  p.set("code_challenge_method", "S256");
  p.set("code_challenge", challenge);
  return u.toString();
}

// 127.0.0.1 のみにbindする1回限りのコールバックサーバー。
// 戻り値 { done, address }: done は成功時 { code, state } で解決し、
// error パラメータ / state 不一致 / タイムアウトで reject する。
// 1回受けたら(またはタイムアウトしたら)サーバーを閉じる。
export function startCallbackServer({ port = 8888, path = "/callback", expectedState, timeoutMs = 120000 } = {}) {
  let settle = null;
  const done = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname !== path) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return; // コールバック以外は無視して待ち続ける
    }
    const html = (msg, status) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html lang="ja"><body><p>${msg}</p></body></html>`);
    };
    const error = u.searchParams.get("error");
    const state = u.searchParams.get("state");
    const code = u.searchParams.get("code");
    if (error) {
      html(`認証に失敗しました (${error})。このページを閉じてください。`, 400);
      finish(new Error(`spotify_error: ${error}`));
    } else if (state !== expectedState) {
      html("state が一致しないため拒否しました。このページを閉じてください。", 400);
      finish(new Error("state_mismatch: state が一致しません (CSRF対策)"));
    } else {
      html("認証が完了しました。このページを閉じてターミナルに戻ってください。", 200);
      finish(null, { code, state });
    }
  });
  let timer = null;
  function finish(err, value) {
    if (!settle) return; // 既に確定済み
    const s = settle;
    settle = null;
    clearTimeout(timer);
    server.close(() => (err ? s.reject(err) : s.resolve(value)));
  }
  timer = setTimeout(() => finish(new Error(`callback_timeout: ${timeoutMs}ms以内にコールバックを受け取りませんでした`)), timeoutMs);
  server.on("error", (err) => finish(err));
  server.listen(port, "127.0.0.1");
  const ready = new Promise((resolve, reject) => {
    server.once("listening", () => resolve(server.address()));
    server.once("error", reject);
  });
  return { done, ready, address: () => server.address() };
}

async function postToken(body, fetchImpl) {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error_description: text.slice(0, 200) };
  }
  if (!res.ok) {
    const desc = [data.error, data.error_description].filter(Boolean).join(": ") || "unknown error";
    throw new Error(`token endpoint error ${res.status}: ${desc}`);
  }
  return data;
}

// 認可コードをアクセストークンに交換する (PKCE: Basic認証ではなく client_id を body に載せる)。
export async function exchangeCodeForToken({ clientId, redirectUri, code, verifier, fetchImpl = fetch } = {}) {
  return postToken(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  }), fetchImpl);
}

// refresh_token でアクセストークンを更新する (PKCE では client_id が必須)。
// 新しい refresh_token が応答に無い場合は、呼び出し側が旧値を保持すること。
export async function refreshAccessToken({ clientId, refreshToken, fetchImpl = fetch } = {}) {
  return postToken(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  }), fetchImpl);
}

// ブラウザでURLを開く。開けなければ false を返す(呼び出し側はURLを表示して待機できる)。
export function openBrowser(url, { platform = process.platform, spawnImpl = spawn } = {}) {
  try {
    let child;
    if (platform === "win32") child = spawnImpl("cmd", ["/c", "start", "", url]);
    else if (platform === "darwin") child = spawnImpl("open", [url]);
    else child = spawnImpl("xdg-open", [url]);
    if (child && typeof child.on === "function") child.on("error", () => {});
    return true;
  } catch {
    return false;
  }
}
