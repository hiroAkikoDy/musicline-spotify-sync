import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchAllEpisodes } from "../../src/nhk/client.js";

const BASE = "https://api.nhk.jp/r8/l/radioepisode/pl/series-rep-Z9WGYY3GP5.json";

const musicItem = (name, dur = "PT3M") => ({ name, duration: dur, byArtist: [{ name: `artist-${name}` }] });
const episodeWithMusic = (id, songName = `song-${id}`) => ({
  id,
  name: `guest-${id}`,
  releasedEvent: { startDate: "2026-10-01T21:45:00+09:00" },
  detailedRecentEvent: { misc: { musicList: [musicItem(songName)] } },
});
const episodeEmpty = (id) => ({
  id,
  name: `guest-${id}`,
  releasedEvent: { startDate: "2026-10-01T21:45:00+09:00" },
  detailedRecentEvent: { misc: { musicList: [] } },
});

function pageOf(eps, nextUrl, count) {
  return { ok: true, status: 200, json: async () => ({ result: eps, nextUrl, count }) };
}

function spyLogger() {
  const calls = { warn: [], log: [] };
  return {
    calls,
    warn: (...a) => calls.warn.push(a.join(" ")),
    log: (...a) => calls.log.push(a.join(" ")),
  };
}

describe("fetchAllEpisodes", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nhk-client-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const cachePath = () => join(dir, "episodes.json");

  test("(a) nextUrlを辿って全ページ取得し、キャッシュに保存する", async () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      if (urls.length === 1) return pageOf([episodeWithMusic("e1"), episodeWithMusic("e2")], `${BASE}?offset=10`, 5);
      if (urls.length === 2) return pageOf([episodeWithMusic("e3")], `${BASE}?offset=20`, 5);
      return pageOf([], null, 5);
    };
    const s = await fetchAllEpisodes({ cachePath: cachePath(), sleepMs: 1000, fetchImpl, sleepImpl: async () => {}, logger: spyLogger() });

    assert.deepEqual(urls, [`${BASE}?offset=0`, `${BASE}?offset=10`, `${BASE}?offset=20`]);
    const cache = JSON.parse(await readFile(cachePath(), "utf8"));
    assert.equal(cache.count, 5);
    assert.equal(typeof cache.fetchedAt, "string");
    assert.deepEqual(Object.keys(cache.episodes).sort(), ["e1", "e2", "e3"]);
    assert.equal(cache.episodes.e1.detailedRecentEvent.misc.musicList[0].name, "song-e1");
    assert.deepEqual(s, { totalCount: 3, withMusic: 3, emptyList: 0, noField: 0, totalTracks: 3 });
  });

  test("(b) リクエスト間にsleepMs(1秒以上)を挟む。初回前にはsleepしない", async () => {
    const sleeps = [];
    const sleepImpl = async (ms) => sleeps.push(ms);
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      if (urls.length === 1) return pageOf([episodeWithMusic("e1")], `${BASE}?offset=10`, 2);
      return pageOf([episodeWithMusic("e2")], null, 2);
    };
    await fetchAllEpisodes({ cachePath: cachePath(), sleepMs: 1000, fetchImpl, sleepImpl, logger: spyLogger() });
    assert.deepEqual(sleeps, [1000]);
    assert.equal(urls.length, 2);
  });

  test("(c) musicList非空でキャッシュ済みのページは全件キャッシュ済みなら再取得せず打ち切り", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `c${i + 1}`);
    const cached = {
      fetchedAt: "2026-10-01T00:00:00.000Z",
      count: 10,
      episodes: Object.fromEntries(ids.map((id) => [id, episodeWithMusic(id)])),
    };
    await writeFile(cachePath(), JSON.stringify(cached), "utf8");

    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      // 同じIDだが内容が異なる(再取得されていれば上書きされてしまう)
      return pageOf(ids.map((id) => episodeWithMusic(id, `FRESH-${id}`)), `${BASE}?offset=10`, 10);
    };
    const sleeps = [];
    const s = await fetchAllEpisodes({ cachePath: cachePath(), sleepMs: 1000, fetchImpl, sleepImpl: async (ms) => sleeps.push(ms), logger: spyLogger() });

    assert.equal(urls.length, 1); // 1ページ目で打ち切り。offset=10は取りに行かない
    assert.deepEqual(sleeps, []);
    const cache = JSON.parse(await readFile(cachePath(), "utf8"));
    assert.equal(cache.episodes.c1.detailedRecentEvent.misc.musicList[0].name, "song-c1"); // キャッシュの内容を保持
    assert.equal(s.withMusic, 10);
  });

  test("(d-1) 空musicListの回は取得結果で更新され、以降の完全キャッシュ済みページで打ち切り", async () => {
    const ids = ["e1", ...Array.from({ length: 9 }, (_, i) => `c${i + 1}`)];
    const nextIds = Array.from({ length: 10 }, (_, i) => `c${i + 11}`);
    const cached = {
      fetchedAt: "2026-10-01T00:00:00.000Z",
      count: 20,
      episodes: Object.fromEntries(
        [...ids, ...nextIds].map((id) => [id, id === "e1" ? episodeEmpty(id) : episodeWithMusic(id)])
      ),
    };
    await writeFile(cachePath(), JSON.stringify(cached), "utf8");

    const urls = [];
    const sleeps = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      if (urls.length === 1) {
        return pageOf(ids.map((id) => (id === "e1" ? episodeWithMusic(id) : episodeWithMusic(id, `FRESH-${id}`))), `${BASE}?offset=10`, 20);
      }
      return pageOf(nextIds.map((id) => episodeWithMusic(id, `FRESH-${id}`)), `${BASE}?offset=20`, 20);
    };
    const s = await fetchAllEpisodes({ cachePath: cachePath(), sleepMs: 1000, fetchImpl, sleepImpl: async (ms) => sleeps.push(ms), logger: spyLogger() });

    assert.equal(urls.length, 2); // 更新のあった1ページ目の次、2ページ目(全件キャッシュ済み)で打ち切り
    assert.deepEqual(sleeps, [1000]);
    const cache = JSON.parse(await readFile(cachePath(), "utf8"));
    assert.equal(cache.episodes.e1.detailedRecentEvent.misc.musicList[0].name, "song-e1"); // 空が更新される
    assert.equal(cache.episodes.c1.detailedRecentEvent.misc.musicList[0].name, "song-c1"); // 非空は上書きされない
    assert.equal(s.withMusic, 20);
    assert.equal(s.emptyList, 0);
  });

  test("(d-2) 空musicListが残るページは打ち切りせず次ページへ", async () => {
    const cached = { fetchedAt: "x", count: 2, episodes: { e1: episodeEmpty("e1") } };
    await writeFile(cachePath(), JSON.stringify(cached), "utf8");

    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(url);
      if (urls.length === 1) return pageOf([episodeEmpty("e1"), episodeWithMusic("c1")], `${BASE}?offset=10`, 3);
      return pageOf([episodeWithMusic("e2")], null, 3);
    };
    const s = await fetchAllEpisodes({ cachePath: cachePath(), sleepMs: 1000, fetchImpl, sleepImpl: async () => {}, logger: spyLogger() });

    assert.equal(urls.length, 2);
    const cache = JSON.parse(await readFile(cachePath(), "utf8"));
    assert.deepEqual(Object.keys(cache.episodes).sort(), ["c1", "e1", "e2"]);
    assert.equal(s.emptyList, 1);
    assert.equal(s.withMusic, 2);
  });

  test("(e) 429はRetry-After秒待ってリトライする", async () => {
    const sleeps = [];
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      if (calls.length === 1) {
        return { ok: false, status: 429, headers: { get: (h) => (h.toLowerCase() === "retry-after" ? "1" : null) } };
      }
      return pageOf([episodeWithMusic("e1")], null, 1);
    };
    const s = await fetchAllEpisodes({ cachePath: cachePath(), sleepMs: 1000, fetchImpl, sleepImpl: async (ms) => sleeps.push(ms), logger: spyLogger() });

    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [1000]); // Retry-After: 1秒
    assert.equal(s.withMusic, 1);
  });

  test("(f) 想定外の構造でも落ちずwarnして続行する", async () => {
    const logger = spyLogger();
    const badMusicList = episodeWithMusic("bad");
    badMusicList.detailedRecentEvent.misc.musicList = "配列ではない";
    const noNameItem = episodeWithMusic("noname");
    noNameItem.detailedRecentEvent.misc.musicList = [{ duration: "PT1M" }];
    const noByArtist = episodeWithMusic("nobyartist");
    noByArtist.detailedRecentEvent.misc.musicList = [{ name: "曲X", duration: "PT1M" }];
    const noId = { name: "idが無い", detailedRecentEvent: { misc: { musicList: [musicItem("s")] } } };

    const fetchImpl = async () =>
      pageOf([episodeWithMusic("e1"), noId, badMusicList, noNameItem, noByArtist], null, 5);
    const s = await fetchAllEpisodes({ cachePath: cachePath(), sleepMs: 1000, fetchImpl, sleepImpl: async () => {}, logger });

    assert.ok(logger.calls.warn.length >= 3, `warn should be logged, got ${logger.calls.warn.length}`);
    const cache = JSON.parse(await readFile(cachePath(), "utf8"));
    assert.ok(!cache.episodes["undefined"]); // id無しは保存しない
    assert.deepEqual(Object.keys(cache.episodes).sort(), ["bad", "e1", "nobyartist", "noname"]);
    assert.equal(s.noField, 1); // musicListが配列でない回
    assert.equal(s.withMusic, 3); // e1 / noname(1曲) / nobyartist
  });

  test("(g) sleepMsが1000未満ならエラー", async () => {
    await assert.rejects(() =>
      fetchAllEpisodes({ cachePath: cachePath(), sleepMs: 999, fetchImpl: async () => pageOf([], null, 0), sleepImpl: async () => {}, logger: spyLogger() })
    );
  });

  test("(h) HTTP 500は指数バックオフで最大3回リトライし、復帰すれば成功", async () => {
    const sleeps = [];
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls <= 2) return { ok: false, status: 500, headers: { get: () => null } };
      return pageOf([episodeWithMusic("e1")], null, 1);
    };
    const s = await fetchAllEpisodes({ cachePath: cachePath(), sleepMs: 1000, fetchImpl, sleepImpl: async (ms) => sleeps.push(ms), logger: spyLogger() });

    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [1000, 2000]); // 1秒, 2秒
    assert.equal(s.withMusic, 1);
  });

  test("(i) 3回リトライしても失敗なら例外", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return { ok: false, status: 500, headers: { get: () => null } };
    };
    await assert.rejects(() =>
      fetchAllEpisodes({ cachePath: cachePath(), sleepMs: 1000, fetchImpl, sleepImpl: async () => {}, logger: spyLogger() })
    );
    assert.equal(calls, 4); // 初回 + 3リトライ
  });
});
