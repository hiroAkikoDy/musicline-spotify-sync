// Spotifyトークンの保存/読込/自動更新。
// 保存先は data/spotify_token.json (.gitignore済み)。ファイル権限は可能な範囲で本人のみ(0600)。
import { readFile, writeFile, rename, mkdir, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { refreshAccessToken } from "./auth.js";

export const DEFAULT_TOKEN_PATH = "data/spotify_token.json";
const REFRESH_MARGIN_MS = 60_000; // 期限60秒前なら自動refresh

export async function loadToken(path = DEFAULT_TOKEN_PATH) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || typeof parsed.access_token !== "string") return null;
  return parsed;
}

// 一時ファイル → rename で原子的に保存。
export async function saveToken(token, path = DEFAULT_TOKEN_PATH) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(token, null, 1), "utf8");
  await rename(tmp, path);
  try {
    await chmod(path, 0o600);
  } catch {
    /* Windowsでは権限モデルが異なるため無視 */
  }
}

// 有効期限内(期限60秒前まで)ならそのまま返す。期限切れ間近なら refresh して保存。
export async function getValidToken({ clientId, path = DEFAULT_TOKEN_PATH, fetchImpl = fetch, now = Date.now } = {}) {
  const token = await loadToken(path);
  if (!token) return null;
  if (typeof token.expires_at === "number" && token.expires_at - REFRESH_MARGIN_MS > now()) return token;
  return forceRefresh({ clientId, path, fetchImpl, now });
}

// 強制的に refresh する。応答に新 refresh_token が無ければ旧値を保持 (Spotify仕様)。
export async function forceRefresh({ clientId, path = DEFAULT_TOKEN_PATH, fetchImpl = fetch, now = Date.now } = {}) {
  const token = await loadToken(path);
  if (!token?.refresh_token) {
    throw new Error("refresh_token が保存されていません (再認証が必要です)");
  }
  const resp = await refreshAccessToken({ clientId, refreshToken: token.refresh_token, fetchImpl });
  const merged = {
    access_token: resp.access_token,
    refresh_token: resp.refresh_token ?? token.refresh_token,
    expires_at: now() + (Number(resp.expires_in) || 0) * 1000,
    scope: resp.scope ?? token.scope,
  };
  await saveToken(merged, path);
  return merged;
}
