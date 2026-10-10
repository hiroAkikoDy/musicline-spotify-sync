import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySync } from "../../src/sync/apply.js";
import { loadState, initialState } from "../../src/sync/state.js";
import { makeTrackKey } from "../../src/nhk/normalize.js";

// ---- フィクスチャ ----
// specs: [{ id, date, titles: [曲名...] }] → NHKキャッシュ形式
function makeCache(specs) {
  const episodes = {};
  for (const s of specs) {
    episodes[s.id] = {
      id: s.id,
      releasedEvent: { startDate: s.date },
      detailedRecentEvent: {
        misc: { musicList: s.titles.map((t) => ({ name: t, duration: "PT3M20S", byArtist: [{ name: `artist-${t}` }] })) },
      },
    };
  }
  return { episodes };
}

// 検索は常に「曲名・アーティスト完全一致の1件」を返す（スコア100で採用される）
function searchMock() {
  const calls = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      const decoded = decodeURIComponent(url);
      const title = /track:"([^"]+)"/.exec(decoded)?.[1] ?? "";
      const artist = /artist:"([^"]+)"/.exec(decoded)?.[1] ?? "";
      return { tracks: { items: [{ id: `id-${title}`, uri: `spotify:track:id-${title}`, name: title, artists: [{ name: artist }], duration_ms: 200000 }] } };
    },
  };
}

// プレイリストAPIモック。store が「Spotify側の真実」。seq に呼び出し順を記録する。
function playlistMock({ existingByPlaylist = {}, failCall = null } = {}) {
  const calls = { create: [], list: [], add: [], seq: [] };
  const store = {};
  for (const [id, uris] of Object.entries(existingByPlaylist)) store[id] = [...uris];
  let addCount = 0;
  const api = {
    createPlaylist: async (_sf, { name, isPublic }) => {
      const id = `pl-${calls.create.length + 1}`;
      calls.create.push({ id, name, isPublic });
      calls.seq.push({ type: "create", id });
      store[id] = store[id] ?? [];
      return { id, name, uri: `spotify:playlist:${id}` };
    },
    listPlaylistUris: async (_sf, id) => {
      calls.list.push(id);
      calls.seq.push({ type: "list", id });
      return [...(store[id] ?? [])];
    },
    addTrackUris: async (_sf, id, uris) => {
      calls.add.push({ id, uris });
      calls.seq.push({ type: "add", id, uris });
      addCount++;
      if (failCall && addCount === failCall.call) {
        // 失敗前に Spotify 側へ反映された分を store に反映してから例外
        const n = failCall.addedBeforeFail;
        store[id] = store[id] ?? [];
        store[id].push(...uris.slice(0, n));
        const err = new Error("chunk failure");
        err.added = n;
        throw err;
      }
      store[id] = store[id] ?? [];
      store[id].push(...uris);
      return { snapshot_id: `s-${addCount}` };
    },
  };
  return { api, calls, store };
}

const QUIET = { log: () => {}, warn: () => {} };

const FOUR_EPISODES = [
  { id: "e1", date: "2026-09-10T21:45:00+09:00", titles: ["曲A-1", "曲A-2"] },
  { id: "e2", date: "2026-09-20T21:45:00+09:00", titles: ["曲B-1"] },
  { id: "e3", date: "2026-10-05T21:45:00+09:00", titles: ["曲C-1", "曲C-2"] },
  { id: "e4", date: "2026-10-08T21:45:00+09:00", titles: ["曲D-1"] },
];
const FOUR_EPISODES_CACHE = () => makeCache(FOUR_EPISODES);
const SLEEP_NONE = async () => {};

// 共通の依存（各テストで playlist/spotifyFetch/state/statePath を上書きする）
const baseOpts = (cache, overrides = {}) => ({
  cache,
  state: initialState(),
  spotifyFetch: searchMock().fetch,
  sleepImpl: SLEEP_NONE,
  logger: QUIET,
  ...overrides,
});

describe("applySync", () => {
  test("初回: 月ごとに作成→list→追加→list(真実確認)の順で実行され、stateに保存される", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apply-test-"));
    try {
      const statePath = join(dir, "state.json");
      const pl = playlistMock();
      const r = await applySync(baseOpts(FOUR_EPISODES_CACHE(), {
        state: initialState(),
        statePath,
        playlist: pl.api,
        yes: true,
      }));

      assert.equal(r.ok, true);
      assert.equal(r.summary.addedTotal, 6); // 6曲
      assert.equal(pl.calls.create.length, 2);
      assert.deepEqual(pl.calls.create.map((c) => c.name), ["\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\u30E9\u30A4\u30F3 2026-09", "\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\u30E9\u30A4\u30F3 2026-10"]);
      assert.ok(pl.calls.create.every((c) => c.isPublic === false)); // 非公開
      assert.equal(pl.calls.add.length, 2);
      assert.equal(pl.calls.add[0].uris.length, 3); // 2026-09: e1(2曲)+e2(1曲)
      assert.equal(pl.calls.add[1].uris.length, 3); // 2026-10: e3(2曲)+e4(1曲)
      // 月ごとに 作成→list→追加→list(追加後の真実確認) の順
      assert.deepEqual(pl.calls.seq.map((s) => s.type), ["create", "list", "add", "list", "create", "list", "add", "list"]);
      // state保存の検証
      const saved = await loadState(statePath);
      assert.equal(saved.playlists["2026-09"].id, "pl-1");
      assert.equal(saved.playlists["2026-10"].id, "pl-2");
      assert.equal(Object.keys(saved.tracks).length, 6);
      assert.equal(Object.keys(saved.episodes).length, 4);
      assert.equal(r.summary.created.length, 2);
      assert.equal(r.summary.unmatchedCount, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("再実行(同じ入力): 処理済みのため作成も追加も検索も発生しない(冪等)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apply-test-"));
    try {
      const statePath = join(dir, "state.json");
      const pl1 = playlistMock();
      await applySync(baseOpts(FOUR_EPISODES_CACHE(), {
        state: initialState(), statePath, playlist: pl1.api, yes: true,
      }));
      const state1 = await loadState(statePath);

      const search2 = searchMock();
      const pl2 = playlistMock();
      const r2 = await applySync(baseOpts(FOUR_EPISODES_CACHE(), {
        state: state1, statePath, spotifyFetch: search2.fetch, playlist: pl2.api, yes: true,
      }));
      assert.equal(r2.ok, true);
      assert.equal(r2.summary.addedTotal, 0);
      assert.equal(pl2.calls.create.length, 0);
      assert.equal(pl2.calls.add.length, 0);
      assert.equal(search2.calls.length, 0); // 処理済み回は対象外・追加済み曲は検索しない
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("stateが空でもプレイリストが既に全曲を持つ場合: 重複追加されず、stateに記録される", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apply-test-"));
    try {
      const statePath = join(dir, "state.json");
      // Spotify側に既に全6曲ある状態を作る（stateは空）
      const pl = playlistMock();
      await applySync(baseOpts(FOUR_EPISODES_CACHE(), {
        state: initialState(), statePath, playlist: pl.api, yes: true,
      }));
      const uris = Object.values(await loadState(statePath).then((s) => s.tracks)).map((t) => t.uri);
      const statePath2 = join(dir, "state2.json");
      const pl2 = playlistMock({ existingByPlaylist: { "pl-1": uris.slice(0, 3), "pl-2": uris.slice(3) } });
      const r = await applySync(baseOpts(FOUR_EPISODES_CACHE(), {
        state: initialState(), statePath: statePath2, playlist: pl2.api, yes: true,
      }));
      assert.equal(r.ok, true);
      assert.equal(r.summary.addedTotal, 0);
      assert.equal(pl2.calls.add.length, 0); // 重複追加しない
      const saved = await loadState(statePath2);
      assert.equal(Object.keys(saved.tracks).length, 6); // Spotify側が真実: 既存分も記録して再検索を防ぐ
      assert.equal(Object.keys(saved.episodes).length, 4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("途中失敗: Spotify側の真実を読み直して state 保存し、再実行で残りだけ追加", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apply-test-"));
    try {
      const statePath = join(dir, "state.json");
      // 150回: e1..e100 は 2026-09, e101..e150 は 2026-10 (日付はすべて過去日=未来日除外の対象外)
      const specs = [];
      for (let i = 1; i <= 100; i++) specs.push({ id: `e${i}`, date: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}T21:45:00+09:00`, titles: [`曲${i}`] });
      for (let i = 101; i <= 150; i++) specs.push({ id: `e${i}`, date: `2026-10-${String(1 + (i % 9)).padStart(2, "0")}T21:45:00+09:00`, titles: [`曲${i}`] });

      const pl = playlistMock({ failCall: { call: 1, addedBeforeFail: 100 } }); // 2026-09の100件追加で失敗、100件は反映済み
      // 書き込み失敗は applySync から例外として再スローされる（CLI側が終了コード1にする）
      await assert.rejects(
        () => applySync(baseOpts(makeCache(specs), {
          state: initialState(), statePath, playlist: pl.api, yes: true,
        })),
        /chunk failure/
      );
      const saved1 = await loadState(statePath);
      assert.equal(Object.keys(saved1.tracks).length, 100); // Spotify側の真実(100件)のみ記録
      assert.equal(saved1.playlists["2026-09"].id, "pl-1"); // 作成済みプレイリストは保存済み
      assert.equal(Object.keys(saved1.episodes).length, 0); // 回はまだ処理済みにしない

      // 再実行: Spotify側には100件ある → 残りの50曲だけ追加される
      const pl2 = playlistMock({ existingByPlaylist: { "pl-1": Object.values(saved1.tracks).map((t) => t.uri) } });
      const search2 = searchMock();
      const r2 = await applySync(baseOpts(makeCache(specs), {
        state: saved1, statePath, spotifyFetch: search2.fetch, playlist: pl2.api, yes: true,
      }));
      assert.equal(r2.ok, true);
      assert.equal(r2.summary.addedTotal, 50);
      const saved2 = await loadState(statePath);
      assert.equal(Object.keys(saved2.tracks).length, 150);
      assert.equal(Object.keys(saved2.episodes).length, 150);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("月が2つ: 別プレイリスト。月をまたぐ重複曲は最初の月に1回だけ", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apply-test-"));
    try {
      const statePath = join(dir, "state.json");
      const cache = makeCache([
        { id: "e1", date: "2026-09-10T21:45:00+09:00", titles: ["共通曲", "曲A"] },
        { id: "e2", date: "2026-10-05T21:45:00+09:00", titles: ["共通曲", "曲C"] }, // 共通曲は重複
      ]);
      const pl = playlistMock();
      const r = await applySync(baseOpts(cache, {
        state: initialState(), statePath, playlist: pl.api, yes: true,
      }));
      assert.equal(r.ok, true);
      assert.equal(r.summary.addedTotal, 3); // 共通曲は 2026-09 にのみ
      assert.equal(pl.calls.create.length, 2);
      assert.equal(pl.calls.add[0].uris.length, 2); // 2026-09: 共通曲+曲A
      assert.equal(pl.calls.add[1].uris.length, 1); // 2026-10: 曲C のみ
      const saved = await loadState(statePath);
      assert.equal(Object.keys(saved.tracks).length, 3);
      assert.equal(saved.tracks[makeTrackKey("共通曲", "artist-共通曲")].month, "2026-09");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("確認プロンプト: n なら書き込み系は一切呼ばれず cancelled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apply-test-"));
    try {
      const statePath = join(dir, "state.json");
      const search = searchMock();
      const pl = playlistMock();
      const confirms = [];
      const r = await applySync(baseOpts(FOUR_EPISODES_CACHE(), {
        state: initialState(), statePath,
        spotifyFetch: search.fetch, playlist: pl.api,
        confirm: async (preview) => { confirms.push(preview); return false; },
      }));
      assert.equal(r.cancelled, true);
      assert.equal(pl.calls.create.length, 0);
      assert.equal(pl.calls.add.length, 0);
      assert.ok(confirms[0].lines.length > 0); // 計画(月別の追加予定曲数・作成予定名)が表示用に渡される
      assert.ok(confirms[0].createdNames.includes("\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\u30E9\u30A4\u30F3 2026-09"));
      await assert.rejects(() => readFile(statePath, "utf8"), /ENOENT/); // state は書かれない
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("--yes 相当: confirm は呼ばれず書き込みが実行される", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apply-test-"));
    try {
      const statePath = join(dir, "state.json");
      const pl = playlistMock();
      let confirmCalled = 0;
      const r = await applySync(baseOpts(FOUR_EPISODES_CACHE(), {
        state: initialState(), statePath, playlist: pl.api, yes: true,
        confirm: async () => { confirmCalled++; return true; },
      }));
      assert.equal(r.ok, true);
      assert.equal(confirmCalled, 0);
      assert.equal(pl.calls.add.length, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("削除系メソッドは一切使われない(検索はGETのみ)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "apply-test-"));
    try {
      const search = searchMock();
      const pl = playlistMock();
      await applySync(baseOpts(FOUR_EPISODES_CACHE(), {
        state: initialState(), statePath: join(dir, "state.json"),
        spotifyFetch: search.fetch, playlist: pl.api, yes: true,
      }));
      assert.ok(search.calls.length > 0); // 検索GETのみ
      assert.ok(pl.calls.create.length > 0);
      assert.ok(pl.calls.add.length > 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
