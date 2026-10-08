import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadToken, saveToken, getValidToken, forceRefresh } from "../../src/spotify/tokenStore.js";

describe("tokenStore", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "spotify-token-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const path = () => join(dir, "spotify_token.json");

  test("loadToken: 未保存ならnull、保存済みなら読める", async () => {
    assert.equal(await loadToken(path()), null);
    const t = { access_token: "AT", refresh_token: "RT", expires_at: 123, scope: "s" };
    await saveToken(t, path());
    assert.deepEqual(await loadToken(path()), t);
  });

  test("saveToken: 原子的書き込みで一時ファイルを残さない", async () => {
    await saveToken({ access_token: "AT", refresh_token: "RT", expires_at: 1, scope: "s" }, path());
    const saved = JSON.parse(await readFile(path(), "utf8"));
    assert.equal(saved.access_token, "AT");
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    assert.deepEqual(files, ["spotify_token.json"]); // tmpファイルが残っていない
  });

  test("getValidToken: 有効期限内なら通信せずそのまま返す", async () => {
    await saveToken({ access_token: "AT", refresh_token: "RT", expires_at: Date.now() + 10 * 60 * 1000, scope: "s" }, path());
    let called = 0;
    const t = await getValidToken({ clientId: "cid", path: path(), fetchImpl: async () => { called++; throw new Error("no network"); } });
    assert.equal(t.access_token, "AT");
    assert.equal(called, 0);
  });

  test("getValidToken: 期限60秒前ならrefreshし、保存も更新する", async () => {
    await saveToken({ access_token: "OLD", refresh_token: "RT0", expires_at: Date.now() + 10 * 1000, scope: "s" }, path());
    const fetchImpl = async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ access_token: "NEW", expires_in: 3600, scope: "s" }),
      json: async () => ({ access_token: "NEW", expires_in: 3600, scope: "s" }),
    });
    const t = await getValidToken({ clientId: "cid", path: path(), fetchImpl });
    assert.equal(t.access_token, "NEW");
    assert.ok(t.expires_at > Date.now() + 50 * 60 * 1000);
    assert.equal(t.refresh_token, "RT0"); // 新refresh_tokenが無い応答なので旧を保持
    const saved = await loadToken(path());
    assert.equal(saved.access_token, "NEW");
    assert.equal(saved.refresh_token, "RT0");
  });

  test("getValidToken: トークンが無ければnull(通信しない)", async () => {
    const t = await getValidToken({ clientId: "cid", path: path(), fetchImpl: async () => { throw new Error("no network"); } });
    assert.equal(t, null);
  });

  test("forceRefresh: 強制的にrefreshし保存する。新refresh_tokenがあれば差し替え", async () => {
    await saveToken({ access_token: "OLD", refresh_token: "RT0", expires_at: Date.now() + 50 * 60 * 1000, scope: "s" }, path());
    const fetchImpl = async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ access_token: "NEW2", refresh_token: "RT1", expires_in: 3600, scope: "s2" }),
      json: async () => ({ access_token: "NEW2", refresh_token: "RT1", expires_in: 3600, scope: "s2" }),
    });
    const t = await forceRefresh({ clientId: "cid", path: path(), fetchImpl });
    assert.equal(t.access_token, "NEW2");
    assert.equal(t.refresh_token, "RT1");
    const saved = await loadToken(path());
    assert.equal(saved.refresh_token, "RT1");
  });

  test("forceRefresh: invalid_grant は例外(再認証が必要)", async () => {
    await saveToken({ access_token: "A", refresh_token: "RT", expires_at: Date.now(), scope: "s" }, path());
    const fetchImpl = async () => ({
      ok: false, status: 400,
      text: async () => JSON.stringify({ error: "invalid_grant", error_description: "expired" }),
      json: async () => ({ error: "invalid_grant" }),
    });
    await assert.rejects(() => forceRefresh({ clientId: "cid", path: path(), fetchImpl }), /400/);
  });
});
