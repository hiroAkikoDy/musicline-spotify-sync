// Phase 0: NHK一覧APIを数ページ叩き、構造を集計する調査スクリプト。
// 使い方: node scripts/survey.js [ページ数=3] [末尾ページ数=2]
// 先頭Nページと、最古側の数ページ(offset 指定)を取得する。リクエスト間は1.2秒sleep。
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = 'https://api.nhk.jp/r8/l/radioepisode/pl/series-rep-Z9WGYY3GP5.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const headPages = Number(process.argv[2] ?? 3);
const tailPages = Number(process.argv[3] ?? 2);

const pages = [];
const first = await getJson(`${BASE}?offset=0`);
const count = first.count;
pages.push({ offset: 0, data: first });
let next = first.nextUrl;
for (let i = 1; i < headPages && next; i++) {
  await sleep(1200);
  const d = await getJson(next);
  pages.push({ offset: i * 10, data: d });
  next = d.nextUrl;
}
// 最古側
const lastOffset = Math.floor((count - 1) / 10) * 10;
for (let i = 0; i < tailPages; i++) {
  const off = lastOffset - i * 10;
  await sleep(1200);
  pages.push({ offset: off, data: await getJson(`${BASE}?offset=${off}`) });
}

const summary = [];
for (const { offset, data } of pages) {
  const eps = data.result ?? [];
  let withMusic = 0, empty = 0, missing = 0, odd = 0, songs = 0;
  const keyShapes = new Set();
  for (const ep of eps) {
    const ml = ep?.detailedRecentEvent?.misc?.musicList;
    if (ml === undefined) { missing++; continue; }
    if (!Array.isArray(ml)) { odd++; continue; }
    if (ml.length === 0) { empty++; continue; }
    withMusic++;
    songs += ml.length;
    for (const m of ml) keyShapes.add(Object.keys(m).sort().join(','));
  }
  const dates = eps.map((e) => e?.releasedEvent?.startDate).filter(Boolean);
  summary.push({
    offset, episodes: eps.length, withMusic, emptyList: empty,
    noMusicListField: missing, nonArray: odd, songs,
    dateRange: [dates.at(-1), dates[0]],
    musicItemKeyShapes: [...keyShapes],
  });
}

await mkdir('out', { recursive: true });
await writeFile('out/survey_raw.json', JSON.stringify(pages, null, 1));
console.log(JSON.stringify({ count, summary }, null, 2));
