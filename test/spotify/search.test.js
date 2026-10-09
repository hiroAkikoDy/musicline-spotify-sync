// Spotify検索ラッパのテスト。実Spotifyには通信しない (spotifyFetchはモック)。
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildQuery,
  searchTracks,
  searchWithFallback,
  MAX_SEARCH_LIMIT,
} from "../../src/spotify/search.js";

// spotifyFetchモック: 呼ばれたpathを記録し、responsesを順に返す (末尾は繰り返し)。
function mockFetch(responses) {
  const queue = Array.isArray(responses) ? responses : [responses];
  const calls = [];
  const fetch = async (path) => {
    calls.push(path);
    return queue[Math.min(calls.length - 1, queue.length - 1)];
  };
  fetch.calls = calls;
  return fetch;
}

const itemsOf = (items) => ({ tracks: { items } });

// /search?... のpathからクエリパラメータを取り出す
function paramsOf(path) {
  return new URLSearchParams(path.slice(path.indexOf("?") + 1));
}

describe("buildQuery", () => {
  test("通常: track: と artist: を組み立てる", () => {
    assert.equal(
      buildQuery({ title: "Night Cruising", artist: "Yumi Matsutoya" }),
      'track:"Night Cruising" artist:"Yumi Matsutoya"'
    );
  });

  test("artistが空・省略なら track: のみ", () => {
    assert.equal(buildQuery({ title: "X" }), 'track:"X"');
    assert.equal(buildQuery({ title: "X", artist: "" }), 'track:"X"');
  });

  test("全角英数は normalizeText (NFKC) で半角にしてから組み立てる", () => {
    assert.equal(
      buildQuery({ title: "ｔｏｍａｔｏ", artist: "Ｃｕｋｏ" }),
      'track:"tomato" artist:"Cuko"'
    );
  });

  test("タイトル内のダブルクォートはエスケープする", () => {
    assert.equal(
      buildQuery({ title: 'Say "Hi"', artist: "A" }),
      'track:"Say \\"Hi\\"" artist:"A"'
    );
  });

  test("複数アーティスト (カンマ区切り) は先頭1名のみ", () => {
    assert.equal(buildQuery({ title: "X", artist: "A, B" }), 'track:"X" artist:"A"');
  });

  test("タイトルが空なら空文字 (検索しない)", () => {
    assert.equal(buildQuery({ title: "", artist: "A" }), "");
    assert.equal(buildQuery({ title: "  ", artist: "A" }), "");
  });
});

describe("searchTracks", () => {
  test("q/type/limit/market をURLSearchParamsで正しくエンコードして1回呼ぶ", async () => {
    const sf = mockFetch(itemsOf([]));
    const out = await searchTracks(sf, { title: "Night Cruising", artist: "Yumi Matsutoya" });
    assert.deepEqual(out, []);
    assert.equal(sf.calls.length, 1);
    const path = sf.calls[0];
    assert.ok(path.startsWith("/search?"), `pathの先頭が /search? ではない: ${path}`);
    const p = paramsOf(path);
    assert.equal(p.get("q"), 'track:"Night Cruising" artist:"Yumi Matsutoya"');
    assert.equal(p.get("type"), "track");
    assert.equal(p.get("limit"), "10");
    assert.equal(p.get("market"), "JP");
    // 生のpath上でもスペースは+、ダブルクォートは%22、コロンは%3Aにエンコードされている
    assert.match(path, /q=track%3A%22Night\+Cruising%22\+artist%3A%22Yumi\+Matsutoya%22/);
  });

  test("items を Candidate に変換する (durationSecは丸め)", async () => {
    const sf = mockFetch(
      itemsOf([
        {
          id: "t1",
          uri: "spotify:track:t1",
          name: "Night Cruising",
          artists: [{ name: "Yumi Matsutoya" }, { name: "Osamu Shitara" }],
          duration_ms: 212500,
        },
      ])
    );
    const out = await searchTracks(sf, { title: "X", artist: "Y" });
    assert.deepEqual(out, [
      {
        id: "t1",
        uri: "spotify:track:t1",
        title: "Night Cruising",
        artists: ["Yumi Matsutoya", "Osamu Shitara"],
        durationSec: 213,
      },
    ]);
  });

  test("応答の欠損 (artists無し・duration_ms無し等) でも落ちない", async () => {
    const sf = mockFetch(
      itemsOf([
        { id: "t2", name: "Only Name" },
        { id: "t3", artists: [{ name: "A" }, {}, { name: 42 }], duration_ms: null },
        {},
      ])
    );
    const out = await searchTracks(sf, { title: "X", artist: "Y" });
    assert.deepEqual(out, [
      { id: "t2", uri: "", title: "Only Name", artists: [], durationSec: null },
      { id: "t3", uri: "", title: "", artists: ["A"], durationSec: null },
      { id: "", uri: "", title: "", artists: [], durationSec: null },
    ]);
  });

  test("tracks が無い・itemsが配列でない応答でも [] を返す", async () => {
    assert.deepEqual(await searchTracks(mockFetch({}), { title: "X" }), []);
    assert.deepEqual(await searchTracks(mockFetch({ tracks: {} }), { title: "X" }), []);
    assert.deepEqual(
      await searchTracks(mockFetch({ tracks: { items: "not-array" } }), { title: "X" }),
      []
    );
  });

  test("0件は [] を返す", async () => {
    const out = await searchTracks(mockFetch(itemsOf([])), { title: "X", artist: "Y" });
    assert.deepEqual(out, []);
  });

  test("limit が上限を超えたら上限 (10) に丸める・指定値はそのまま", async () => {
    assert.equal(MAX_SEARCH_LIMIT, 10);
    const sf = mockFetch(itemsOf([]));
    await searchTracks(sf, { title: "X" }, { limit: 50 });
    assert.equal(paramsOf(sf.calls[0]).get("limit"), "10");
    const sf2 = mockFetch(itemsOf([]));
    await searchTracks(sf2, { title: "X" }, { limit: 3 });
    assert.equal(paramsOf(sf2.calls[0]).get("limit"), "3");
  });

  test("デフォルトは limit=10・market=JP", async () => {
    const sf = mockFetch(itemsOf([]));
    await searchTracks(sf, { title: "X" });
    const p = paramsOf(sf.calls[0]);
    assert.equal(p.get("limit"), "10");
    assert.equal(p.get("market"), "JP");
  });

  test("titleが空ならAPIを呼ばず [] を返す", async () => {
    const sf = mockFetch(itemsOf([]));
    const out = await searchTracks(sf, { title: "", artist: "Y" });
    assert.deepEqual(out, []);
    assert.equal(sf.calls.length, 0);
  });
});

describe("searchWithFallback", () => {
  test("1回目でヒットすれば再検索しない (usedFallback: false)", async () => {
    const sf = mockFetch(itemsOf([{ id: "t1", name: "Hit" }]));
    const out = await searchWithFallback(sf, { title: "X", artist: "A" });
    assert.deepEqual(out, {
      candidates: [{ id: "t1", uri: "", title: "Hit", artists: [], durationSec: null }],
      usedFallback: false,
      query: 'track:"X" artist:"A"',
    });
    assert.equal(sf.calls.length, 1);
  });

  test("0件なら artist 抜きで再検索する (usedFallback: true)", async () => {
    const sf = mockFetch([itemsOf([]), itemsOf([{ id: "t9", name: "Fallback Hit" }])]);
    const out = await searchWithFallback(sf, { title: "X", artist: "A" });
    assert.deepEqual(out, {
      candidates: [{ id: "t9", uri: "", title: "Fallback Hit", artists: [], durationSec: null }],
      usedFallback: true,
      query: 'track:"X"',
    });
    assert.equal(sf.calls.length, 2);
    assert.equal(paramsOf(sf.calls[0]).get("q"), 'track:"X" artist:"A"');
    assert.equal(paramsOf(sf.calls[1]).get("q"), 'track:"X"');
  });

  test("両方0件なら candidates=[]・usedFallback: true", async () => {
    const sf = mockFetch([itemsOf([]), itemsOf([])]);
    const out = await searchWithFallback(sf, { title: "X", artist: "A" });
    assert.deepEqual(out, { candidates: [], usedFallback: true, query: 'track:"X"' });
    assert.equal(sf.calls.length, 2);
  });

  test("artistが最初から無ければ再検索しない", async () => {
    const sf = mockFetch([itemsOf([]), itemsOf([{ id: "t9", name: "called?" }])]);
    const out = await searchWithFallback(sf, { title: "X" });
    assert.deepEqual(out, { candidates: [], usedFallback: false, query: 'track:"X"' });
    assert.equal(sf.calls.length, 1);
  });
});
