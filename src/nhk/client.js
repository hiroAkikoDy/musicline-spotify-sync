// NHK ラジオエピソード一覧APIの取得(ページング・sleep・リトライ・キャッシュ付き)。
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const BASE_URL = "https://api.nhk.jp/r8/l/radioepisode/pl/series-rep-Z9WGYY3GP5.json";
const MAX_RETRIES = 3;
const MIN_SLEEP_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoffMs = (attempt) => 1000 * 2 ** (attempt - 1); // 1秒, 2秒, 4秒

const musicListOf = (ep) => ep?.detailedRecentEvent?.misc?.musicList;
const hasMusic = (ep) => {
  const ml = musicListOf(ep);
  return Array.isArray(ml) && ml.length > 0;
};

// 取得したエピソードの想定外の形を警告する。id が無い(保存不可)場合は false を返す。
function warnUnexpectedEpisode(ep, logger) {
  if (!ep || typeof ep !== "object" || typeof ep.id !== "string" || ep.id === "") {
    logger.warn(`id が無いエピソードをスキップ: ${JSON.stringify(ep)?.slice(0, 120)}`);
    return false;
  }
  const ml = musicListOf(ep);
  if (ml !== undefined && !Array.isArray(ml)) {
    logger.warn(`musicList が配列でありません (id=${ep.id})`);
  } else if (Array.isArray(ml)) {
    ml.forEach((item, i) => {
      if (!item || typeof item !== "object" || typeof item.name !== "string") {
        logger.warn(`musicList[${i}] に name がありません (id=${ep.id})`);
      } else if (!Array.isArray(item.byArtist)) {
        logger.warn(`musicList[${i}] に byArtist がありません (id=${ep.id})`);
      }
    });
  }
  return true;
}

// HTTPエラー・通信エラーを最大 MAX_RETRIES 回リトライ(指数バックオフ、429はRetry-After尊重)。
async function fetchJsonWithRetry(url, fetchImpl, { sleepImpl, logger }) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url);
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err;
      const waitMs = backoffMs(attempt + 1);
      logger.warn(`通信エラー (${err?.message ?? err}) → ${waitMs}ms後にリトライ (${attempt + 1}/${MAX_RETRIES})`);
      await sleepImpl(waitMs);
      continue;
    }
    if (res.ok) return await res.json();
    // 5xx と 429、通信エラーのみ再試行。404 など再試行が無意味な4xxは即例外。
    if (res.status < 500 && res.status !== 429) throw new Error(`HTTP ${res.status} ${url}`);
    if (attempt >= MAX_RETRIES) throw new Error(`HTTP ${res.status} ${url}`);
    let waitMs = backoffMs(attempt + 1);
    if (res.status === 429) {
      const retryAfterSec = Number(res.headers?.get?.("retry-after"));
      if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) waitMs = retryAfterSec * 1000;
    }
    logger.warn(`HTTP ${res.status} → ${waitMs}ms後にリトライ (${attempt + 1}/${MAX_RETRIES})`);
    await sleepImpl(waitMs);
  }
}

async function loadCache(cachePath, logger) {
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.episodes && typeof parsed.episodes === "object") {
      // complete が無い旧形式のキャッシュは未完走(false)として扱う
      return { fetchedAt: parsed.fetchedAt ?? null, count: parsed.count ?? 0, complete: parsed.complete === true, episodes: parsed.episodes };
    }
    logger.warn(`キャッシュの形式が不正のため新規作成します: ${cachePath}`);
  } catch (err) {
    if (err?.code !== "ENOENT") logger.warn(`キャッシュ読み込みに失敗したため新規作成します: ${err?.message ?? err}`);
  }
  return { fetchedAt: null, count: 0, complete: false, episodes: {} };
}

// 一時ファイル → rename で原子的に書き込む。
async function saveCache(cachePath, cache) {
  await mkdir(dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(cache, null, 1), "utf8");
  await rename(tmp, cachePath);
}

function summarize(cache) {
  let withMusic = 0, emptyList = 0, noField = 0, totalTracks = 0;
  for (const ep of Object.values(cache.episodes)) {
    const ml = musicListOf(ep);
    if (!Array.isArray(ml)) { noField++; continue; }
    if (ml.length === 0) { emptyList++; continue; }
    withMusic++;
    totalTracks += ml.length;
  }
  return { totalCount: withMusic + emptyList + noField, withMusic, emptyList, noField, totalTracks };
}

// 全エピソードを nextUrl で辿って取得し、キャッシュに保存して集計を返す。
// - musicList が非空のキャッシュ済み回は上書きしない(空の回は取得結果で更新)
// - 1ページ全件が「musicList非空でキャッシュ済み」になったら打ち切る(増分実行)
export async function fetchAllEpisodes({
  cachePath = "data/episodes.json",
  sleepMs = 1200,
  fetchImpl = fetch,
  sleepImpl = sleep,
  logger = console,
} = {}) {
  if (!Number.isFinite(sleepMs) || sleepMs < MIN_SLEEP_MS) {
    throw new Error(`sleepMs は ${MIN_SLEEP_MS} 以上必要です (NHKサーバーへの配慮): 指定値=${sleepMs}`);
  }

  const cache = await loadCache(cachePath, logger);
  const wasComplete = cache.complete === true; // 前回完走済みか(増分打ち切りはこれがあるときだけ有効)
  let apiCount = cache.count ?? 0;
  let url = `${BASE_URL}?offset=0`;
  let pageCount = 0;
  let cutOff = false;

  while (url) {
    const data = await fetchJsonWithRetry(url, fetchImpl, { sleepImpl, logger });
    if (data?.result !== undefined && !Array.isArray(data?.result)) {
      logger.warn(`result が配列でありません: ${url}`);
    }
    const result = Array.isArray(data?.result) ? data.result : [];
    if (Number.isFinite(data?.count)) apiCount = data.count;

    let updated = 0, skipped = 0;
    for (const ep of result) {
      if (!warnUnexpectedEpisode(ep, logger)) continue;
      const cached = cache.episodes[ep.id];
      if (cached && hasMusic(cached)) { skipped++; continue; }
      cache.episodes[ep.id] = ep;
      updated++;
    }

    pageCount++;
    logger.log(`[fetch] GET ${url} → ${result.length}件 (保存/更新 ${updated}件, キャッシュ済みスキップ ${skipped}件)`);

    // 「このページの全件が、以前からキャッシュ済みの非空musicListの回」で、かつ前回完走済み
    // (complete=true)の場合だけ増分打ち切り。未完走のキャッシュでは打ち切らず最後まで辿る
    // (全件取得の途中で中断しても、再実行で続きから取得される)。
    const pageAllCached = result.length > 0 && updated === 0 && result.every((ep) => hasMusic(cache.episodes[ep.id]));
    if (pageAllCached && wasComplete) {
      cutOff = true;
      logger.log(`[fetch] ${pageCount}ページ目全体がキャッシュ済みのため取得を打ち切り`);
      break;
    }

    cache.fetchedAt = new Date().toISOString();
    cache.count = apiCount;
    cache.complete = false; // 辿り切っていない間は未完了。ここで例外が起きれば false のまま残る
    await saveCache(cachePath, cache);

    url = typeof data?.nextUrl === "string" ? data.nextUrl : null;
    if (url) await sleepImpl(sleepMs);
  }

  // 最後まで辿り切った、または増分打ち切りした場合は完走として complete: true を保存。
  // 例外で中断した場合はここに来ないため、キャッシュは complete: false のまま残る。
  cache.complete = true;
  cache.fetchedAt = new Date().toISOString();
  await saveCache(cachePath, cache);

  return summarize(cache);
}
