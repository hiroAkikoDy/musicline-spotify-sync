import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../../src/sync/plan.js";

// ヘルパー: エピソードを作る
const ep = (id, startDate, songs) => ({
  id,
  releasedEvent: { startDate },
  detailedRecentEvent: {
    misc: { musicList: songs.map(([name, artist, dur]) => ({ name, artist, duration: dur, byArtist: [{ name: artist }] })) },
  },
});
const song = (name, artist, dur = "PT3M30S") => [name, artist, dur];

const NOW = new Date("2026-10-09T00:00:00Z");

describe("buildPlan", () => {
  const cache = {
    episodes: {
      e1: ep("e1", "2026-09-07T21:45:00+09:00", [song("古い回の曲", "アーティストA")]), // musicList 公開前だが曲あり(テスト用)
      e2: ep("e2", "2026-09-10T21:45:00+09:00", [song("曲X", "歌手X"), song("NEW POINT", "西岡大貴")]),
      e3: ep("e3", "2026-09-20T21:45:00+09:00", [song("曲Ｙ", "ＹＵＩ"), song("new point", "西岡大貴")]),
      e4: ep("e4", "2026-09-30T15:00:00Z", [song("曲Z", "歌手Z")]), // JST 2026-10-01 00:00
      e5: ep("e5", "2026-09-30T14:00:00Z", [song("曲W", "歌手W")]), // JST 2026-09-30 23:00
      e6: ep("e6", "2026-10-15T21:45:00+09:00", []), // 未放送(musicList空)
      e7: ep("e7", "2999-01-01T21:45:00+09:00", [song("未来の曲", "未来歌手")]), // 未来日なのに曲あり
      e8: { id: "e8", releasedEvent: { startDate: "2026-10-01T21:45:00+09:00" } }, // musicList フィールドなし
    },
  };

  test("曲を持つ回のみ対象。musicList空・フィールドなし・未来日は除外される", () => {
    const p = buildPlan(cache, { now: NOW });
    assert.equal(p.episodesSelected, 5); // e1..e5 (e6,e7,e8 は除外)
  });

  test("since: 放送日(JST)以降の回のみ", () => {
    const p = buildPlan(cache, { since: "2026-09-10", now: NOW });
    const months = Object.keys(p.months);
    assert.ok(!p.months["2026-09"] || !p.months["2026-09"].some((t) => t.title === "古い回の曲"));
    // e1 (2026-09-07) は除外されている
    assert.ok(months.includes("2026-10"));
    assert.equal(p.months["2026-09"].some((t) => t.title === "曲X"), true);
  });

  test("limit: 新しい順にN回(曲を持つ回のみカウント)", () => {
    const p = buildPlan(cache, { limit: 2, now: NOW });
    assert.equal(p.episodesSelected, 2); // e4/e5 (10-01/09-30 が新しい2回)
    const titles = Object.values(p.months).flat().map((t) => t.title);
    assert.deepEqual(titles.sort(), ["曲W", "曲Z"]);
  });

  test("テーマ曲はデフォルト除外・includeTheme=true で含める(重複排除は適用される)。除外件数を返す", () => {
    const p = buildPlan(cache, { now: NOW });
    const titles = Object.values(p.months).flat().map((t) => t.title);
    assert.ok(!titles.includes("NEW POINT"));
    assert.ok(!titles.includes("new point"));
    assert.equal(p.themeRemoved, 2); // e2, e3 のテーマ曲(テーマ除外が重複排除より先のため重複カウントにはならない)
    assert.equal(p.duplicates, 0);

    const withTheme = buildPlan(cache, { includeTheme: true, now: NOW });
    const titles2 = Object.values(withTheme.months).flat().map((t) => t.title.toLowerCase());
    // includeTheme=true でも回をまたぐ重複排除は適用されるため、NEW POINT は最初の出現(e2)に1件だけ残る
    assert.equal(titles2.filter((t) => t === "new point").length, 1);
    assert.equal(withTheme.themeRemoved, 0);
    assert.equal(withTheme.duplicates, 1);
  });

  test("全角表記のテーマ曲（ＮＥＷ　ＰＯＩＮＴ / 西岡大貴）も除外される", () => {
    const c = {
      episodes: {
        e1: {
          id: "e1",
          releasedEvent: { startDate: "2026-10-01T21:45:00+09:00" },
          detailedRecentEvent: {
            misc: {
              musicList: [{ name: "ＮＥＷ　ＰＯＩＮＴ", duration: "PT1M", byArtist: [{ name: "西岡大貴" }] }],
            },
          },
        },
      },
    };
    const p = buildPlan(c, { now: NOW });
    assert.equal(p.totalTracks, 0);
    assert.equal(p.themeRemoved, 1);
  });

  test("重複排除: テーマ以外の同一曲(NFKC/大文字小文字違い)は最初に出現した月に1件だけ", () => {
    // 曲Ｙ(e3, 09-20, 全角) と 曲Y(e5, 09-30, 半角) は同一曲 → 最初に出現した 2026-09 に1件だけ残る
    const c = {
      episodes: {
        ea: ep("ea", "2026-09-01T21:45:00+09:00", [song("ｔｏｍａｔｏ", "ＹＵＩ")]),
        eb: ep("eb", "2026-09-25T21:45:00+09:00", [song("Tomato", "yui")]),
      },
    };
    const p = buildPlan(c, { now: NOW });
    assert.equal(p.duplicates, 1);
    assert.equal(p.totalTracks, 1);
    // Track の title は extractTracks で NFKC 正規化済み(全角→半角)で返る
    const survived = Object.entries(p.months).flatMap(([m, ts]) => ts.map((t) => [m, t.title]));
    assert.deepEqual(survived, [["2026-09", "tomato"]]); // 最初の出現(古い回)に残る
  });

  test("月境界: JST 0時またぎ。UTC表記でも JST の月にグルーピングされる", () => {
    const p = buildPlan(cache, { now: NOW });
    const monthOf = (title) => {
      for (const [m, ts] of Object.entries(p.months)) if (ts.some((t) => t.title === title)) return m;
      return null;
    };
    assert.equal(monthOf("曲Z"), "2026-10"); // 2026-09-30T15:00Z = JST 2026-10-01
    assert.equal(monthOf("曲W"), "2026-09"); // 2026-09-30T14:00Z = JST 2026-09-30
    assert.deepEqual(p.monthOrder, ["2026-09", "2026-10"]);
  });

  test("集計: totalTracks と episodesSelected", () => {
    const p = buildPlan(cache, { now: NOW });
    const total = Object.values(p.months).reduce((a, ts) => a + ts.length, 0);
    assert.equal(p.totalTracks, total);
    assert.equal(p.episodesSelected, 5);
    // 古い回の曲, 曲X, 曲Ｙ, 曲W, 曲Z の5件(テーマ曲2件はテーマ除外で除去・重複ペアは到達しない)
    assert.equal(p.totalTracks, 5);
    assert.equal(p.duplicates, 0);
    assert.equal(p.themeRemoved, 2);
  });
});
