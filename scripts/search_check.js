#!/usr/bin/env node
// Spotify検索チェック: 引数の曲名(・アーティスト)で検索し、Candidate を表示する。
// 使い方: node scripts/search_check.js "曲名" ["アーティスト"]
// ユーザー操作は不要 (保存トークン使用)。トークンは絶対に表示しない。
// 1回目の検索が0件のときだけ artist 抜きで再検索する (searchWithFallback の仕様)。
// リクエスト間隔は1秒以上あけて実行すること (連続実行時)。
import { readFile } from "node:fs/promises";
import { createSpotifyClient } from "../src/spotify/client.js";
import { getValidToken, forceRefresh, DEFAULT_TOKEN_PATH } from "../src/spotify/tokenStore.js";
import { searchWithFallback } from "../src/spotify/search.js";

// .env を読む (内容は表示しない・書き換えない)。auth_check.js と同じ自前パース。
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

function formatDuration(sec) {
  if (sec === null || sec === undefined) return "--:--";
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

async function main() {
  const [titleArg, artistArg] = process.argv.slice(2);
  if (!titleArg) {
    console.error('使い方: node scripts/search_check.js "曲名" ["アーティスト"]');
    process.exitCode = 1;
    return;
  }
  const env = await loadEnv();
  const clientId = env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    console.error("SPOTIFY_CLIENT_ID が未設定です (.env を確認してください)。");
    process.exitCode = 1;
    return;
  }

  const token = await getValidToken({ clientId, path: DEFAULT_TOKEN_PATH });
  if (!token) {
    console.error(`保存済みトークンがありません (${DEFAULT_TOKEN_PATH})。先に scripts/auth_check.js で再認証してください。`);
    process.exitCode = 1;
    return;
  }

  const spotifyFetch = createSpotifyClient({
    getToken: async () => (await getValidToken({ clientId, path: DEFAULT_TOKEN_PATH }))?.access_token,
    refreshToken: async () => (await forceRefresh({ clientId, path: DEFAULT_TOKEN_PATH })).access_token,
  });

  const track = { title: titleArg, artist: artistArg ?? "" };
  const { candidates, usedFallback, query } = await searchWithFallback(spotifyFetch, track);
  console.log(`検索語: ${query}${usedFallback ? " (アーティスト付きは0件のため artist 抜きで再検索)" : ""}`);
  console.log(`候補: ${candidates.length}件`);
  for (const c of candidates) {
    const artists = c.artists.length > 0 ? c.artists.join(", ") : "(アーティスト不明)";
    console.log(`- ${c.title} / ${artists} [${formatDuration(c.durationSec)}] ${c.uri} (id: ${c.id})`);
  }
}

main().catch((err) => {
  if (/refresh_token が保存されていません/.test(err?.message ?? "")) {
    console.error("再認証が必要です。scripts/auth_check.js を実行してください。");
  } else if (/invalid_grant/.test(err?.message ?? "")) {
    console.error("refresh_token が無効です (失効/期限切れ)。data/spotify_token.json を削除して scripts/auth_check.js で再認証してください。");
  } else {
    console.error(`エラー: ${err?.message ?? err}`);
  }
  process.exitCode = 1;
});
