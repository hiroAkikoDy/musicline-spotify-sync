import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isThemeSong, filterThemeSongs } from "../../src/match/theme.js";

function track(title, artist) {
  return { title, artist, durationSec: null, episodeId: "ep1", airDate: "2026-10-05" };
}

describe("isThemeSong", () => {
  test("曲名 NEW POINT + 西岡大貴 -> true", () => {
    assert.equal(isThemeSong(track("NEW POINT", "西岡大貴")), true);
  });
  test("大文字小文字を無視 (new point)", () => {
    assert.equal(isThemeSong(track("New Point", "西岡大貴")), true);
  });
  test("全角表記 ＮＥＷ　ＰＯＩＮＴ -> true", () => {
    assert.equal(isThemeSong(track("ＮＥＷ　ＰＯＩＮＴ", "西岡大貴")), true);
  });
  test("曲名だけ一致でアーティスト違い -> false", () => {
    assert.equal(isThemeSong(track("NEW POINT", "その他アーティスト")), false);
  });
  test("アーティストだけ一致で曲名違い -> false", () => {
    assert.equal(isThemeSong(track("TOMATO", "西岡大貴")), false);
  });
});

describe("filterThemeSongs", () => {
  const list = [
    track("TOMATO", "山田太郎"),
    track("ＮＥＷ　ＰＯＩＮＴ", "西岡大貴"),
    track("ORANGE", "鈴木花子"),
  ];
  test("デフォルト(includeTheme=false)はテーマ曲を除外し順序保持", () => {
    const res = filterThemeSongs(list);
    assert.deepEqual(res.map((t) => t.title), ["TOMATO", "ORANGE"]);
  });
  test("includeTheme=true はテーマ曲を含めて返す", () => {
    const res = filterThemeSongs(list, { includeTheme: true });
    assert.equal(res.length, 3);
    assert.ok(res.some((t) => t.title === "ＮＥＷ　ＰＯＩＮＴ"));
  });
});
