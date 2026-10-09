import { fetchAllEpisodes } from "./nhk/client.js";
import { readFile } from "node:fs/promises";
import { buildPlan } from "./sync/plan.js";
import { runMatch } from "./sync/runMatch.js";
import { buildSummary, printReport, writeReports } from "./sync/report.js";
import { MIN_SCORE_DEFAULT } from "./match/pickBest.js";
import { createSpotifyClient } from "./spotify/client.js";
import { loadToken, getValidToken, forceRefresh, DEFAULT_TOKEN_PATH } from "./spotify/tokenStore.js";

// .env を読む（内容は表示しない・書き換えない）。auth_check.js と同じ自前パース。
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

function parseSyncArgs(args) {
  const opts = { dryRun: false, includeTheme: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--include-theme") opts.includeTheme = true;
    else if (a === "--since") opts.since = args[++i];
    else if (a === "--limit") opts.limit = Number(args[++i]);
    else if (a === "--min-score") opts.minScore = Number(args[++i]);
    else {
      console.error(`不明なオプション: ${a}`);
      return null;
    }
  }
  if (opts.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(opts.since)) {
    console.error(`--since は YYYY-MM-DD 形式で指定してください: ${opts.since}`);
    return null;
  }
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit <= 0)) {
    console.error(`--limit は正の整数で指定してください: ${opts.limit}`);
    return null;
  }
  if (opts.minScore !== undefined && !Number.isFinite(opts.minScore)) {
    console.error(`--min-score は数値で指定してください: ${opts.minScore}`);
    return null;
  }
  return opts;
}

async function runSync(rest) {
  const opts = parseSyncArgs(rest);
  if (!opts) {
    process.exitCode = 1;
    return;
  }
  if (!opts.dryRun) {
    console.error("Spotifyへの書き込みは未実装（Phase 4）です。--dry-run を付けて実行してください。");
    process.exitCode = 1;
    return;
  }
  let cache;
  try {
    cache = JSON.parse(await readFile("data/episodes.json", "utf8"));
  } catch {
    console.error("data/episodes.json が見つかりません。先に `node src/index.js fetch` を実行してください。");
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
  const token = await loadToken(DEFAULT_TOKEN_PATH);
  if (!token?.refresh_token) {
    console.error(`Spotifyのトークンがありません (${DEFAULT_TOKEN_PATH})。先に \`node scripts/auth_check.js\` を実行してください。`);
    process.exitCode = 1;
    return;
  }

  const plan = buildPlan(cache, { since: opts.since, limit: opts.limit, includeTheme: opts.includeTheme });
  const tracks = plan.monthOrder.flatMap((m) => plan.months[m]);
  const minScore = opts.minScore ?? MIN_SCORE_DEFAULT;
  console.log(`対象: ${plan.episodesSelected}回 / ${tracks.length}曲 (テーマ曲除外 ${plan.themeRemoved}件, 重複除外 ${plan.duplicates}件, minScore=${minScore}) で検索します...`);

  const spotifyFetch = createSpotifyClient({
    getToken: async () => (await getValidToken({ clientId, path: DEFAULT_TOKEN_PATH }))?.access_token,
    refreshToken: async () => (await forceRefresh({ clientId, path: DEFAULT_TOKEN_PATH })).access_token,
  });
  const results = await runMatch(tracks, spotifyFetch, { minScore });
  const summary = buildSummary({ plan, results, minScore });
  printReport(summary, { minScore });
  await writeReports(summary);
  console.log("out/unmatched.csv と out/matched_preview.csv を出力しました (Spotifyへの書き込みはしていません)。");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "fetch") {
    const s = await fetchAllEpisodes();
    console.log("--- 集計 (data/episodes.json) ---");
    console.log(`総数: ${s.totalCount}`);
    console.log(`曲ありの回数: ${s.withMusic}`);
    console.log(`空の回数: ${s.emptyList}`);
    console.log(`フィールドなしの回数: ${s.noField}`);
    console.log(`総曲数: ${s.totalTracks}`);
    return;
  }
  if (cmd === "sync") {
    await runSync(rest);
    return;
  }
  console.error(`未実装: ${cmd ?? "(コマンドを指定してください)"} — 利用可能: fetch, sync --dry-run`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
