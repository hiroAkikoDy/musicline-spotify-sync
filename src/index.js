import { fetchAllEpisodes } from "./nhk/client.js";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { buildPlan } from "./sync/plan.js";
import { runMatch } from "./sync/runMatch.js";
import { buildSummary, printReport, writeReports } from "./sync/report.js";
import { applySync } from "./sync/apply.js";
import { loadState } from "./sync/state.js";
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
  const opts = { dryRun: false, includeTheme: false, yes: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--include-theme") opts.includeTheme = true;
    else if (a === "--yes") opts.yes = true;
    else if (a === "--since") opts.since = args[++i];
    else if (a === "--limit") opts.limit = Number(args[++i]);
    else if (a === "--min-score") opts.minScore = Number(args[++i]);
    else if (a === "--max-add") opts.maxAdd = Number(args[++i]);
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
  if (opts.maxAdd !== undefined && (!Number.isInteger(opts.maxAdd) || opts.maxAdd < 0)) {
    console.error(`--max-add は 0 以上の整数で指定してください: ${opts.maxAdd}`);
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
  const spotifyFetch = createSpotifyClient({
    getToken: async () => (await getValidToken({ clientId, path: DEFAULT_TOKEN_PATH }))?.access_token,
    refreshToken: async () => (await forceRefresh({ clientId, path: DEFAULT_TOKEN_PATH })).access_token,
  });
  const minScore = opts.minScore ?? MIN_SCORE_DEFAULT;

  if (opts.dryRun) {
    // --dry-run: 挙動は変えない（書き込みなし・従来どおりのレポート出力）
    const plan = buildPlan(cache, { since: opts.since, limit: opts.limit, includeTheme: opts.includeTheme });
    const tracks = plan.monthOrder.flatMap((m) => plan.months[m]);
    console.log(`対象: ${plan.episodesSelected}回 / ${tracks.length}曲 (テーマ曲除外 ${plan.themeRemoved}件, 重複除外 ${plan.duplicates}件, minScore=${minScore}) で検索します...`);
    const results = await runMatch(tracks, spotifyFetch, { minScore });
    const summary = buildSummary({ plan, results, minScore });
    printReport(summary, { minScore });
    await writeReports(summary);
    console.log("out/unmatched.csv と out/matched_preview.csv を出力しました (Spotifyへの書き込みはしていません)。");
    return;
  }

  // 書き込みモード（--dry-run なし）。applySync が検索(読み取りのみ)→確認→書き込みまで担う
  const state = await loadState("data/state.json");
  const result = await applySync({
    cache,
    state,
    statePath: "data/state.json",
    spotifyFetch,
    opts: { limit: opts.limit, since: opts.since, includeTheme: opts.includeTheme, minScore, maxAdd: opts.maxAdd },
    yes: opts.yes === true,
    confirm: writeConfirm(),
    logger: console,
  });
  if (result.cancelled) {
    console.log("書き込みを中止しました。");
    return;
  }
  if (result.exceeded) {
    console.error(`追加予定 ${result.preview.totalAdds}曲 が上限 ${result.maxAdd}曲 を超えたため、1曲も書き込まずに中止しました。`);
    console.error("手動で `node src/index.js sync --dry-run` で内容を確認するか、--max-add の値を見直してください。");
    process.exitCode = 2;
    return;
  }
  printWriteSummary(result);
  if (!result.ok) {
    console.error("書き込み中にエラーが発生しました。state は途中まで保存されています。同じコマンドの再実行で続きから再開できます。");
    process.exitCode = 1;
  }
}

function printWriteSummary(result) {
  if (result.preview?.lines?.length) {
    console.log("--- 実行内容 ---");
    for (const line of result.preview.lines) console.log(line);
  }
  const s = result.summary;
  if (!s) return;
  console.log("--- 書き込みサマリ ---");
  for (const c of s.created) console.log(`プレイリストを作成: ${c.name} (${c.id})`);
  const monthLines = Object.entries(s.addedByMonth).map(([m, n]) => `${m}: ${n}曲`);
  console.log(`追加曲数: ${s.addedTotal}曲${monthLines.length > 0 ? ` (${monthLines.join(" / ")})` : ""}`);
  console.log(`スキップ: 処理済み回 ${s.skipped.processedEpisodes}回 / 追加済み曲 ${s.skipped.existingTracks}曲`);
  console.log(`未マッチ: ${s.unmatchedCount}曲 / エラー: ${s.errorCount}曲`);
}

// 書き込み直前の1回だけ確認する（マッチング自体は読み取りのみ）。
function writeConfirm() {
  return async (preview) => {
    for (const line of preview.lines) console.log(line);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("上記の内容でSpotifyに書き込みますか? [y/N]: ")).trim().toLowerCase();
    rl.close();
    return answer === "y";
  };
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
