// Task 1C: 過去回の単体取得API調査（読み取り専用・最大5リクエスト・リクエスト間1.2秒sleep）。
// 使い方: node scripts/survey_single.js
// 結果は out/survey_single.json に保存。同じidは再取得しない。
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const OUT = 'out/survey_single.json';
const BASE = 'https://api.nhk.jp/r8/t/radioepisode/re/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 年代を散らして対象を選ぶ（データ: 一覧APIキャッシュ）
const DATE_PREFIXES = ['2020', '2022', '2024', '2026-08', '2026-09-07'];

const cache = JSON.parse(await readFile('data/episodes.json', 'utf8'));
const episodes = Object.values(cache.episodes).map((e) => ({
  id: e.id,
  date: e?.releasedEvent?.startDate ?? null,
  listHasMusicList: Array.isArray(e?.detailedRecentEvent?.misc?.musicList),
}));

const targets = DATE_PREFIXES.map((p) =>
  episodes.filter((e) => e.date && e.date.startsWith(p)).sort((a, b) => a.date.localeCompare(b.date)).at(0)
).filter(Boolean);

// 既取得分は再取得しない
let prev = { results: [], raw: {} };
try {
  prev = JSON.parse(await readFile(OUT, 'utf8'));
} catch {
  /* 初回 */
}
const doneIds = new Set(prev.results.map((r) => r.id));
const todo = targets.filter((t) => !doneIds.has(t.id));

const results = [...prev.results];
const raw = { ...prev.raw };
let requestCount = 0;
for (const t of todo) {
  if (requestCount > 0) await sleep(1200);
  requestCount++;
  const url = `${BASE}${t.id}.json`;
  let entry = { id: t.id, date: t.date, listHasMusicList: t.listHasMusicList, url };
  try {
    const res = await fetch(url);
    requestCount += 0; // 1リクエスト = 1エピソード
    entry.status = res.status;
    if (res.ok) {
      const body = await res.json();
      raw[t.id] = body;
      const misc = body?.detailedRecentEvent?.misc;
      const ml = misc?.musicList;
      entry.hasDetailedRecentEvent = body?.detailedRecentEvent !== undefined;
      entry.hasMisc = misc !== undefined;
      if (Array.isArray(ml)) {
        entry.musicList = { present: true, count: ml.length, firstTrack: ml[0] ?? null };
      } else {
        entry.musicList = { present: false };
        entry.candidateFields = {
          detailedRecentEventKeys: body?.detailedRecentEvent ? Object.keys(body.detailedRecentEvent) : null,
          miscKeys: misc ? Object.keys(misc) : null,
          description: typeof body?.description === 'string' ? body.description.slice(0, 150) : (body?.description !== undefined ? typeof body.description : null),
          citationCount: Array.isArray(body?.citation) ? body.citation.length : 0,
          hasPartCount: Array.isArray(body?.hasPart) ? body.hasPart.length : 0,
          detailedPinnedCitationKeys: body?.detailedPinnedCitation ? Object.keys(body.detailedPinnedCitation) : null,
          topKeys: body ? Object.keys(body) : null,
        };
      }
    } else {
      entry.error = `HTTP ${res.status}`;
    }
  } catch (err) {
    entry.error = String(err?.message ?? err);
  }
  results.push(entry);
  console.log(`[survey_single] GET ${url} → ${entry.status ?? entry.error}`);
}

await mkdir('out', { recursive: true });
await writeFile(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), requestCount: (prev.requestCount ?? 0) + requestCount, results, raw }, null, 1));
console.log(JSON.stringify({ requestCountThisRun: requestCount, totalResults: results.length, summary: results.map(({ raw: _r, ...r }) => r) }, null, 1));
