// NOTE: All Japanese literals are written as \uXXXX escapes so this file is pure ASCII
// (immune to console/editor encoding damage). Strings resolve to the same values at runtime.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState, initialState, setPlaylist, getPlaylist, recordTracks, hasTrack, markEpisode, isEpisodeProcessed, recordUnmatched } from "../../src/sync/state.js";
import { makeTrackKey } from "../../src/nhk/normalize.js";

const TEJUN = "\u624B\u52D5"; // manual-check word in the error message
const KW_TOMATO_FW = makeTrackKey("\uFF54\uFF4F\uFF4D\uFF41\uFF54\uFF4F", "\uFF39\uFF35\uFF29"); // fullwidth tomato / YUI
const KW_TOMATO = makeTrackKey("tomato", "yui");
const KW_A = makeTrackKey("\u66F2A", "\u6B4C\u624BA"); // (songA, artistA)
const KW_B = makeTrackKey("\u66F2B", "\u6B4C\u624BB");
const PLAYLIST_NAME = "\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\u30E9\u30A4\u30F3 2026-09"; // program name + month

describe("loadState", () => {
  test("missing file returns empty initial state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "state-test-"));
    try {
      const s = await loadState(join(dir, "state.json"));
      assert.equal(s.version, 1);
      assert.deepEqual(s.playlists, {});
      assert.deepEqual(s.tracks, {});
      assert.deepEqual(s.episodes, {});
      assert.deepEqual(s.unmatched, []);
      assert.equal(typeof s.updatedAt, "string");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("valid file is loaded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "state-test-"));
    try {
      const file = join(dir, "state.json");
      await writeFile(file, JSON.stringify({
        version: 1,
        updatedAt: "2026-10-10T00:00:00.000Z",
        playlists: { "2026-09": { id: "pl1", name: PLAYLIST_NAME, createdAt: "2026-10-01T00:00:00.000Z" } },
        tracks: { "tomato|yui": { uri: "spotify:track:1", month: "2026-09", episodeId: "e1", addedAt: "2026-10-01T00:00:00.000Z" } },
        episodes: { e1: { processedAt: "2026-10-01T00:00:00.000Z", matched: 3, unmatched: 1 } },
        unmatched: [{ episodeId: "e1", airDate: "2026-09-10", title: "t", artist: "a" }],
      }), "utf8");
      const s = await loadState(file);
      assert.equal(s.playlists["2026-09"].id, "pl1");
      assert.equal(s.tracks["tomato|yui"].uri, "spotify:track:1");
      assert.equal(s.episodes.e1.matched, 3);
      assert.equal(s.unmatched.length, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("broken JSON throws with path and manual-fix hint; file is NOT overwritten", async () => {
    const dir = await mkdtemp(join(tmpdir(), "state-test-"));
    try {
      const file = join(dir, "state.json");
      const broken = '{ "version": 1, "tracks": { ';
      await writeFile(file, broken, "utf8");
      await assert.rejects(
        () => loadState(file),
        (err) => {
          assert.match(err.message, /state\.json/);
          assert.ok(err.message.includes(file));
          assert.ok(err.message.includes(TEJUN)); // manual-fix hint present
          return true;
        }
      );
      assert.equal(await readFile(file, "utf8"), broken); // file untouched
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("unknown version throws; file is NOT overwritten", async () => {
    const dir = await mkdtemp(join(tmpdir(), "state-test-"));
    try {
      const file = join(dir, "state.json");
      const content = JSON.stringify({ version: 2, updatedAt: "x", playlists: {}, tracks: {}, episodes: {}, unmatched: [] });
      await writeFile(file, content, "utf8");
      await assert.rejects(() => loadState(file), /version/);
      assert.equal(await readFile(file, "utf8"), content); // file untouched
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("valid version with missing fields gets defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "state-test-"));
    try {
      const file = join(dir, "state.json");
      await writeFile(file, JSON.stringify({ version: 1 }), "utf8");
      const s = await loadState(file);
      assert.deepEqual(s.playlists, {});
      assert.deepEqual(s.unmatched, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("saveState", () => {
  test("save/load roundtrip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "state-test-"));
    try {
      const file = join(dir, "state.json");
      const s0 = initialState();
      const s1 = setPlaylist(s0, "2026-09", { id: "pl1", name: PLAYLIST_NAME });
      const s2 = recordTracks(s1, [{ key: KW_A, uri: "spotify:track:1", month: "2026-09", episodeId: "e1" }]);
      const saved = await saveState(s2, file);
      assert.equal(typeof saved.updatedAt, "string"); // updatedAt refreshed
      const loaded = await loadState(file);
      assert.equal(loaded.playlists["2026-09"].id, "pl1");
      assert.equal(loaded.tracks[KW_A].uri, "spotify:track:1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("atomic write: no temp file left behind", async () => {
    const dir = await mkdtemp(join(tmpdir(), "state-test-"));
    try {
      const file = join(dir, "state.json");
      await saveState(initialState(), file);
      const files = await readdir(dir);
      assert.deepEqual(files, ["state.json"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("creates missing parent directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "state-test-"));
    try {
      const file = join(dir, "data", "state.json");
      await saveState(initialState(), file);
      assert.equal((await loadState(file)).version, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("pure update functions (immutable, month validation)", () => {
  const base = initialState();

  test("setPlaylist/getPlaylist: input state is not mutated", () => {
    const before = JSON.stringify(base);
    const s1 = setPlaylist(base, "2026-09", { id: "pl1", name: PLAYLIST_NAME });
    assert.equal(JSON.stringify(base), before); // input unchanged
    assert.equal(getPlaylist(s1, "2026-09").id, "pl1");
    assert.equal(getPlaylist(s1, "2026-09").name, PLAYLIST_NAME);
    assert.ok(getPlaylist(s1, "2026-09").createdAt);
    assert.equal(getPlaylist(base, "2026-09"), null);
    assert.equal(getPlaylist(s1, "2026-10"), null);
    // re-set keeps createdAt
    const s2 = setPlaylist(s1, "2026-09", { id: "pl1b", name: "n2" });
    assert.equal(s2.playlists["2026-09"].createdAt, s1.playlists["2026-09"].createdAt);
    assert.equal(s2.playlists["2026-09"].id, "pl1b");
  });

  test("invalid month format throws", () => {
    assert.throws(() => setPlaylist(base, "2026-9", { id: "x" }), /YYYY-MM/);
    assert.throws(() => setPlaylist(base, "2026-13", { id: "x" }), /YYYY-MM/);
    assert.throws(() => setPlaylist(base, "abc", { id: "x" }), /YYYY-MM/);
  });

  test("recordTracks: first-wins; NFKC/case variants share one makeTrackKey slot", () => {
    const s1 = recordTracks(base, [
      { key: KW_TOMATO_FW, uri: "spotify:track:1", month: "2026-09", episodeId: "e1" },
      { key: KW_TOMATO, uri: "spotify:track:2", month: "2026-10", episodeId: "e2" }, // same key -> ignored
      { key: KW_B, uri: "spotify:track:3", month: "2026-10", episodeId: "e2" },
    ]);
    assert.equal(Object.keys(s1.tracks).length, 2);
    assert.equal(s1.tracks[KW_TOMATO].uri, "spotify:track:1"); // first wins
    assert.equal(s1.tracks[KW_TOMATO].month, "2026-09");
    assert.equal(hasTrack(s1, KW_TOMATO), true);
    assert.equal(hasTrack(base, KW_TOMATO), false);
    assert.deepEqual(base.tracks, {}); // input unchanged
  });

  test("recordTracks: key omitted -> computed via makeTrackKey(title, artist)", () => {
    const s1 = recordTracks(base, [{ title: "\u66F2A", artist: "\u6B4C\u624BA", uri: "spotify:track:1", month: "2026-09", episodeId: "e1" }]);
    assert.equal(hasTrack(s1, KW_A), true);
  });

  test("recordTracks: invalid month / missing uri throw", () => {
    assert.throws(() => recordTracks(base, [{ key: "k", uri: "u", month: "2026-9" }]), /YYYY-MM/);
    assert.throws(() => recordTracks(base, [{ key: "k", month: "2026-09" }]), /uri/);
  });

  test("markEpisode / isEpisodeProcessed", () => {
    const s1 = markEpisode(base, "e1", { matched: 3, unmatched: 1 });
    assert.equal(isEpisodeProcessed(s1, "e1"), true);
    assert.equal(isEpisodeProcessed(base, "e1"), false);
    assert.equal(s1.episodes.e1.matched, 3);
    assert.equal(s1.episodes.e1.unmatched, 1);
    assert.ok(s1.episodes.e1.processedAt);
    assert.deepEqual(base.episodes, {}); // input unchanged
  });

  test("recordUnmatched: same episodeId+title+artist is not stacked twice", () => {
    const items = [
      { episodeId: "e1", airDate: "2026-09-10", title: "\u66F2X", artist: "\u6B4C\u624BX" },
      { episodeId: "e1", airDate: "2026-09-10", title: "\u66F2X", artist: "\u6B4C\u624BX" }, // dup
      { episodeId: "e2", airDate: "2026-09-20", title: "\u66F2X", artist: "\u6B4C\u624BX" }, // different episode -> keep
      { episodeId: "e1", airDate: "2026-09-10", title: "\u66F2X", artist: "\u6B4C\u624BY" }, // different artist -> keep
    ];
    const s1 = recordUnmatched(base, items);
    assert.equal(s1.unmatched.length, 3);
    const s2 = recordUnmatched(s1, items); // re-adding adds nothing
    assert.equal(s2.unmatched.length, 3);
    assert.deepEqual(base.unmatched, []); // input unchanged
  });
});
