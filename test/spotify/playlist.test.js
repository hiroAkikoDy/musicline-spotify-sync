import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createPlaylist, listPlaylistUris, addTrackUris, ensureNotAlreadyAdded } from "../../src/spotify/playlist.js";

function spyFetch(responses) {
  // responses: 順に返す解析済みJSON。関数を渡した場合は (path, opts) を受け取って返す。
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : null;
  return {
    calls,
    fetch: async (path, opts) => {
      calls.push({ path, opts });
      if (typeof responses === "function") return responses(path, opts, calls.length);
      const next = queue.shift();
      return next;
    },
  };
}

describe("createPlaylist", () => {
  test("POST /me/playlists に name/description/public=false で作成する(既定は非公開)", async () => {
    const s = spyFetch([{ id: "pl1", name: "ミュージックライン 2026-09", uri: "spotify:playlist:pl1", snapshot_id: "s1" }]);
    const p = await createPlaylist(s.fetch, { name: "ミュージックライン 2026-09" });
    assert.deepEqual(p, { id: "pl1", name: "ミュージックライン 2026-09", uri: "spotify:playlist:pl1" });
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].path, "/me/playlists");
    assert.equal(s.calls[0].opts.method, "POST");
    assert.equal(s.calls[0].opts.body.name, "ミュージックライン 2026-09");
    assert.equal(s.calls[0].opts.body.description, "");
    assert.equal(s.calls[0].opts.body.public, false); // 既定は非公開
    assert.equal(s.calls[0].opts.headers["Content-Type"], "application/json");
  });

  test("isPublic=true で公開・description も送る", async () => {
    const s = spyFetch([{ id: "pl2", name: "n", uri: "u" }]);
    await createPlaylist(s.fetch, { name: "n", description: "d", isPublic: true });
    assert.equal(s.calls[0].opts.body.public, true);
    assert.equal(s.calls[0].opts.body.description, "d");
  });

  test("name が無ければエラー(APIを呼ばない)", async () => {
    const s = spyFetch([]);
    await assert.rejects(() => createPlaylist(s.fetch, {}), /name/);
    await assert.rejects(() => createPlaylist(s.fetch, { name: "" }), /name/);
    assert.equal(s.calls.length, 0);
  });
});

describe("listPlaylistUris", () => {
  test("複数ページを最後まで辿る(next でページング・limit=50)", async () => {
    const s = spyFetch([
      { items: [{ item: { uri: "spotify:track:1" } }, { item: { uri: "spotify:track:2" } }], next: "https://api.spotify.com/v1/playlists/pl/items?offset=50" },
      { items: [{ item: { uri: "spotify:track:3" } }], next: null },
    ]);
    const uris = await listPlaylistUris(s.fetch, "pl1");
    assert.deepEqual(uris, ["spotify:track:1", "spotify:track:2", "spotify:track:3"]);
    assert.equal(s.calls.length, 2);
    assert.equal(s.calls[0].path, "/playlists/pl1/items?limit=50&offset=0");
    assert.equal(s.calls[1].path, "https://api.spotify.com/v1/playlists/pl/items?offset=50"); // next をそのまま辿る
  });

  test("uri が無い・null のアイテムや item:null (ローカル) は無視して落ちない", async () => {
    const s = spyFetch([
      { items: [{ item: { uri: "spotify:track:a" } }, { item: null }, { track: { uri: "spotify:track:b" } }, {}, { item: { uri: null } }, { item: { uri: "spotify:track:c" } }], next: null },
    ]);
    const uris = await listPlaylistUris(s.fetch, "pl1");
    assert.deepEqual(uris, ["spotify:track:a", "spotify:track:b", "spotify:track:c"]);
  });

  test("0件なら空配列", async () => {
    const s = spyFetch([{ items: [], next: null }]);
    assert.deepEqual(await listPlaylistUris(s.fetch, "pl1"), []);
  });

  test("next があるのに items が空でも無限ループしない", async () => {
    const s = spyFetch([
      { items: [], next: "https://api.spotify.com/v1/playlists/pl/items?offset=50" },
    ]);
    const uris = await listPlaylistUris(s.fetch, "pl1");
    assert.deepEqual(uris, []);
    assert.equal(s.calls.length, 1);
  });
});

describe("addTrackUris", () => {
  test("0件ならAPIを呼ばない", async () => {
    const s = spyFetch([]);
    const r = await addTrackUris(s.fetch, "pl1", []);
    assert.deepEqual(r, { added: 0, chunks: 0 });
    assert.equal(s.calls.length, 0);
  });

  test("100件ちょうどは1チャンク。POST のパス・ボディを検証", async () => {
    const uris = Array.from({ length: 100 }, (_, i) => `spotify:track:${i}`);
    const s = spyFetch([{ snapshot_id: "s" }]);
    const r = await addTrackUris(s.fetch, "pl1", uris);
    assert.deepEqual(r, { added: 100, chunks: 1 });
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].path, "/playlists/pl1/items");
    assert.equal(s.calls[0].opts.method, "POST");
    assert.deepEqual(s.calls[0].opts.body.uris, uris);
    assert.equal(s.calls[0].opts.headers["Content-Type"], "application/json");
  });

  test("101件は2チャンク(100+1)・250件は3チャンク(100+100+50)", async () => {
    const make = (n) => Array.from({ length: n }, (_, i) => `spotify:track:${i}`);
    const s101 = spyFetch([{ snapshot_id: "1" }, { snapshot_id: "2" }]);
    const r1 = await addTrackUris(s101.fetch, "pl", make(101));
    assert.deepEqual(r1, { added: 101, chunks: 2 });
    assert.equal(s101.calls[1].opts.body.uris.length, 1);

    const s250 = spyFetch([{ snapshot_id: "1" }, { snapshot_id: "2" }, { snapshot_id: "3" }]);
    const r2 = await addTrackUris(s250.fetch, "pl", make(250));
    assert.deepEqual(r2, { added: 250, chunks: 3 });
    assert.equal(s250.calls[2].opts.body.uris.length, 50);
  });

  test("入力内の重複は除いてから追加する(先勝ち・順序保持)", async () => {
    const s = spyFetch([{ snapshot_id: "1" }]);
    const r = await addTrackUris(s.fetch, "pl", ["spotify:track:a", "spotify:track:a", "spotify:track:b", "spotify:track:a"]);
    assert.deepEqual(r, { added: 2, chunks: 1 });
    assert.deepEqual(s.calls[0].opts.body.uris, ["spotify:track:a", "spotify:track:b"]);
  });

  test("2チャンク目で失敗したら例外に追加済み件数を持たせる", async () => {
    const calls = [];
    const fetchImpl = async (path, opts) => {
      calls.push({ path, opts });
      if (calls.length === 1) return { snapshot_id: "s1" };
      const err = new Error("server error");
      throw err;
    };
    const uris = Array.from({ length: 150 }, (_, i) => `spotify:track:${i}`);
    await assert.rejects(
      () => addTrackUris(fetchImpl, "pl", uris),
      (err) => {
        assert.equal(err.added, 100); // 1チャンク目の100件まで追加済み
        assert.equal(err.chunkIndex, 1);
        assert.equal(err.totalChunks, 2);
        assert.match(err.message, /100件/);
        return true;
      }
    );
    assert.equal(calls.length, 2);
  });
});

describe("ensureNotAlreadyAdded", () => {
  test("完全重複は空・部分重複は新規のみ・順序保持", () => {
    assert.deepEqual(ensureNotAlreadyAdded(["u1", "u2"], ["u1", "u2"]), []);
    assert.deepEqual(ensureNotAlreadyAdded(["u1"], ["u1", "u2", "u3"]), ["u2", "u3"]);
    assert.deepEqual(ensureNotAlreadyAdded([], ["u2", "u1"]), ["u2", "u1"]);
    assert.deepEqual(ensureNotAlreadyAdded(["u1"], []), []);
  });
});
