import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildAuthorizeUrl, startCallbackServer, exchangeCodeForToken, refreshAccessToken, openBrowser } from "../../src/spotify/auth.js";

describe("buildAuthorizeUrl", () => {
  test("必須クエリを含む /authorize URL を返す", () => {
    const url = new URL(buildAuthorizeUrl({
      clientId: "cid123",
      redirectUri: "http://127.0.0.1:8888/callback",
      scopes: ["playlist-modify-private", "playlist-modify-public"],
      state: "st123",
      challenge: "ch456",
    }));
    assert.equal(url.origin + url.pathname, "https://accounts.spotify.com/authorize");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), "cid123");
    assert.equal(url.searchParams.get("scope"), "playlist-modify-private playlist-modify-public");
    assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:8888/callback");
    assert.equal(url.searchParams.get("state"), "st123");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), "ch456");
  });
});

describe("startCallbackServer", () => {
  test("正常系: code/state を返し、応答後にサーバーを閉じる", async () => {
    const cb = startCallbackServer({ port: 0, path: "/callback", expectedState: "S1", timeoutMs: 5000 });
    const addr = await cb.ready;
    assert.equal(addr.address, "127.0.0.1"); // 127.0.0.1以外にbindしない
    // 異なるパスは無視される(404で継続)
    const probe = await fetch(`http://127.0.0.1:${addr.port}/favicon.ico`);
    assert.equal(probe.status, 404);
    const res = await fetch(`http://127.0.0.1:${addr.port}/callback?code=ABC&state=S1`);
    assert.equal(res.status, 200);
    assert.deepEqual(await cb.done, { code: "ABC", state: "S1" });
    // 1回受けたら閉じる
    await assert.rejects(() => fetch(`http://127.0.0.1:${addr.port}/callback?code=X&state=S1`));
  });

  test("state不一致は拒否する", async () => {
    const cb = startCallbackServer({ port: 0, path: "/callback", expectedState: "OK1", timeoutMs: 5000 });
    const addr = await cb.ready;
    await fetch(`http://127.0.0.1:${addr.port}/callback?code=ABC&state=BAD`);
    await assert.rejects(() => cb.done, /state_mismatch/);
  });

  test("errorパラメータはエラーとして返す", async () => {
    const cb = startCallbackServer({ port: 0, path: "/callback", expectedState: "E1", timeoutMs: 5000 });
    const addr = await cb.ready;
    await fetch(`http://127.0.0.1:${addr.port}/callback?error=access_denied&state=E1`);
    await assert.rejects(() => cb.done, /access_denied/);
  });

  test("タイムアウトでrejectする", async () => {
    const cb = startCallbackServer({ port: 0, path: "/callback", expectedState: "T1", timeoutMs: 300 });
    const start = Date.now();
    await assert.rejects(() => cb.done, /timeout/i);
    assert.ok(Date.now() - start < 5000, "timeout should be honored promptly");
  });
});

function jsonRes(obj, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(obj), json: async () => obj };
}

describe("exchangeCodeForToken", () => {
  test("PKCEパラメータでPOSTする(Authorization Basicは付けない)", async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      return jsonRes({ access_token: "AT", refresh_token: "RT", expires_in: 3600, scope: "s1 s2" });
    };
    const token = await exchangeCodeForToken({
      clientId: "cid", redirectUri: "http://127.0.0.1:8888/callback", code: "C1", verifier: "V1", fetchImpl,
    });
    assert.equal(token.access_token, "AT");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://accounts.spotify.com/api/token");
    assert.equal(calls[0].opts.method, "POST");
    assert.equal(calls[0].opts.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.equal(calls[0].opts.headers.Authorization, undefined); // PKCEではBasic認証を使わない
    const body = new URLSearchParams(calls[0].opts.body);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), "C1");
    assert.equal(body.get("redirect_uri"), "http://127.0.0.1:8888/callback");
    assert.equal(body.get("client_id"), "cid");
    assert.equal(body.get("code_verifier"), "V1");
  });
  test("HTTPエラーは本文を含めて例外", async () => {
    const fetchImpl = async () => jsonRes({ error: "invalid_grant", error_description: "bad code" }, 400);
    await assert.rejects(
      () => exchangeCodeForToken({ clientId: "c", redirectUri: "r", code: "x", verifier: "v", fetchImpl }),
      /400.*invalid_grant/s
    );
  });
});

describe("refreshAccessToken", () => {
  test("grant_type=refresh_token + client_id でPOSTする(PKCE)", async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      return jsonRes({ access_token: "AT2", expires_in: 3600, scope: "s1 s2" });
    };
    const token = await refreshAccessToken({ clientId: "cid", refreshToken: "RT0", fetchImpl });
    assert.equal(token.access_token, "AT2");
    assert.ok(!("refresh_token" in token) || token.refresh_token === undefined); // 新refresh_tokenが無い応答
    const body = new URLSearchParams(calls[0].opts.body);
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("refresh_token"), "RT0");
    assert.equal(body.get("client_id"), "cid");
    assert.equal(calls[0].opts.headers.Authorization, undefined);
  });
});

describe("openBrowser", () => {
  test("プラットフォーム別コマンドで起動し、失敗時はfalse(手動URL表示にフォールバック)", async () => {
    const calls = [];
    const ok = await openBrowser("https://accounts.spotify.com/authorize?x=1", {
      platform: "win32",
      spawnImpl: (cmd, args) => { calls.push([cmd, args]); return { on: () => {} }; },
    });
    assert.equal(ok, true);
    assert.deepEqual(calls[0], ["cmd", ["/c", "start", "", "https://accounts.spotify.com/authorize?x=1"]]);

    const okLinux = await openBrowser("https://x.example", {
      platform: "linux",
      spawnImpl: (cmd, args) => { calls.push([cmd, args]); return { on: () => {} }; },
    });
    assert.equal(okLinux, true);
    assert.deepEqual(calls[1], ["xdg-open", ["https://x.example"]]);

    const failed = await openBrowser("https://x.example", {
      platform: "darwin",
      spawnImpl: () => { throw new Error("no browser"); },
    });
    assert.equal(failed, false);
  });
});
