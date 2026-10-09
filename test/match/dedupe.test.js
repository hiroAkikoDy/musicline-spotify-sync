import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { dedupeTracks } from "../../src/match/dedupe.js";

function track(title, artist, i) {
  return { title, artist, durationSec: null, episodeId: `ep${i}`, airDate: "2026-10-05" };
}

describe("dedupeTracks", () => {
  test("全角半角・大文字小文字違いは同一曲として重複排除し最初の1件を残す", () => {
    const res = dedupeTracks([track("ｔｏｍａｔｏ", "山田太郎", 1), track("TOMATO", "山田太郎", 2)]);
    assert.equal(res.unique.length, 1);
    assert.equal(res.duplicates, 1);
    assert.equal(res.unique[0].episodeId, "ep1");
  });
  test("アーティストが違えば別曲として扱う", () => {
    const res = dedupeTracks([track("TOMATO", "山田太郎", 1), track("TOMATO", "鈴木花子", 2)]);
    assert.equal(res.unique.length, 2);
    assert.equal(res.duplicates, 0);
  });
  test("順序保持", () => {
    const res = dedupeTracks([
      track("C", "x", 1),
      track("A", "y", 2),
      track("C", "x", 3),
      track("B", "z", 4),
    ]);
    assert.deepEqual(res.unique.map((t) => t.title), ["C", "A", "B"]);
    assert.equal(res.duplicates, 1);
  });
  test("重複なし", () => {
    const res = dedupeTracks([track("A", "x", 1), track("B", "y", 2)]);
    assert.equal(res.unique.length, 2);
    assert.equal(res.duplicates, 0);
  });
  test("空配列", () => {
    assert.deepEqual(dedupeTracks([]), { unique: [], duplicates: 0 });
  });
});
