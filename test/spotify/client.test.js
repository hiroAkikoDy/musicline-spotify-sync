import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createSpotifyClient } from "../../src/spotify/client.js";

function res(obj, status = 200, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => headers[h.toLowerCase()] ?? null },
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  };
}

describe("spotifyFetch", () => {
  test("Bearerトークンを付与し、/me はv1URLに結合される", async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      return res({ display_name: "taro" });
    };
    const spotifyFetch = createSpotifyClient({
      getToken: async () => "TOK1",
      fetchImpl,
    });
    const data = await spotifyFetch("/me");
    assert.deepEqual(data, { display_name: "taro" });
    assert.equal(calls[0].url, "https://api.spotify.com/v1/me");
    assert.equal(calls[0].opts.headers.Authorization, "Bearer TOK1");
  });

  test("401なら1回だけrefreshして再試行する", async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push(opts.headers.Authorization);
      return calls.length === 1 ? res({ error: "expired" }, 401) : res({ ok: true });
    };
    let refreshes = 0;
    const spotifyFetch = createSpotifyClient({
      getToken: async () => "OLD",
      refreshToken: async () => { refreshes++; return "NEW"; },
      fetchImpl,
    });
    await spotifyFetch("/me");
    assert.equal(refreshes, 1);
    assert.deepEqual(calls, ["Bearer OLD", "Bearer NEW"]);
  });

  test("refresh後も401なら例外(無限リトライしない)", async () => {
    const fetchImpl = async () => res({ error: "no" }, 401);
    let refreshes = 0;
    const spotifyFetch = createSpotifyClient({
      getToken: async () => "OLD",
      refreshToken: async () => { refreshes++; return "NEW"; },
      fetchImpl,
    });
    await assert.rejects(() => spotifyFetch("/me"), /401/);
    assert.equal(refreshes, 1);
  });

  test("429はRetry-After秒だけ待って再試行する", async () => {
    let n = 0;
    const sleeps = [];
    const fetchImpl = async () => {
      n++;
      return n === 1 ? res({}, 429, { "retry-after": "2" }) : res({ done: 1 });
    };
    const spotifyFetch = createSpotifyClient({
      getToken: async () => "T",
      fetchImpl,
      sleepImpl: async (ms) => sleeps.push(ms),
    });
    await spotifyFetch("/me");
    assert.deepEqual(sleeps, [2000]);
    assert.equal(n, 2);
  });

  test("429が5回待っても続くなら例外", async () => {
    let n = 0;
    const sleeps = [];
    const fetchImpl = async () => {
      n++;
      return res({}, 429, { "retry-after": "1" });
    };
    const spotifyFetch = createSpotifyClient({
      getToken: async () => "T",
      fetchImpl,
      sleepImpl: async (ms) => sleeps.push(ms),
    });
    await assert.rejects(() => spotifyFetch("/me"), /429/);
    assert.equal(sleeps.length, 5); // 最大5回待機
    assert.equal(n, 6);
  });

  test("その他のエラーは本文を含めて例外", async () => {
    const fetchImpl = async () => res({ error: { message: "not found" } }, 404);
    const spotifyFetch = createSpotifyClient({ getToken: async () => "T", fetchImpl });
    await assert.rejects(() => spotifyFetch("/me"), /404.*not found/s);
  });
});
