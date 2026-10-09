import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { pickBest, MIN_SCORE_DEFAULT } from "../../src/match/pickBest.js";

function track(title, artist, durationSec = null) {
  return { title, artist, durationSec, episodeId: "ep1", airDate: "2026-10-05" };
}
function candidate(id, title, artists, durationSec = null) {
  return { id, uri: `spotify:track:${id}`, title, artists, durationSec };
}

describe("pickBest", () => {
  test("MIN_SCORE_DEFAULT = 60", () => {
    assert.equal(MIN_SCORE_DEFAULT, 60);
  });
  test("最高スコアの候補を選び runnerUp に2位を返す", () => {
    const t = track("Tomato", "YAMADA TARO", 180);
    const c1 = candidate("a", "Tomato", ["YAMADA TARO"], 180);
    const c2 = candidate("b", "Tomato Soup", ["YAMADA TARO"], 180);
    const r = pickBest(t, [c1, c2]);
    assert.equal(r.best.id, "a");
    assert.equal(r.score, 100);
    assert.equal(r.runnerUp.id, "b");
    assert.ok(r.detail.title);
  });
  test("閾値未満なら best: null", () => {
    const t = track("Tomato", "YAMADA TARO", 180);
    const c1 = candidate("a", "Tomato Soup", ["YAMADA TARO JR."], 186);
    const r = pickBest(t, [c1]);
    assert.equal(r.best, null);
  });
  test("minScore オプションで閾値を下げると選ばれる", () => {
    const t = track("Tomato", "YAMADA TARO", 180);
    const c1 = candidate("a", "Tomato Soup", ["YAMADA TARO JR."], 186);
    const r = pickBest(t, [c1], { minScore: 40 });
    assert.equal(r.best.id, "a");
    assert.equal(r.score, 45);
  });
  test("minScore ちょうどのスコアは選ばれる", () => {
    const t = track("Tomato", "YAMADA TARO", 180);
    const c1 = candidate("a", "Tomato", ["YAMADA TARO JR."], 186);
    const r = pickBest(t, [c1], { minScore: 60 });
    assert.equal(r.best.id, "a");
  });
  test("同点は候補の並び順で先を優先", () => {
    const t = track("Tomato", "YAMADA TARO", 180);
    const c1 = candidate("first", "Tomato", ["YAMADA TARO"], 180);
    const c2 = candidate("second", "Tomato", ["YAMADA TARO"], 180);
    const r = pickBest(t, [c1, c2]);
    assert.equal(r.best.id, "first");
    assert.equal(r.runnerUp.id, "second");
  });
  test("2位が閾値未満でも runnerUp は返す", () => {
    const t = track("Tomato", "YAMADA TARO", 180);
    const c1 = candidate("a", "Tomato", ["YAMADA TARO"], 180);
    const c2 = candidate("b", "Orange", ["SUZUKI"], 300);
    const r = pickBest(t, [c1, c2]);
    assert.equal(r.best.id, "a");
    assert.equal(r.runnerUp.id, "b");
  });
  test("候補0件 -> best:null, score:0, detail:null, runnerUp:null", () => {
    const r = pickBest(track("Tomato", "YAMADA TARO"), []);
    assert.equal(r.best, null);
    assert.equal(r.score, 0);
    assert.equal(r.detail, null);
    assert.equal(r.runnerUp, null);
  });
  test("全角英数混在の候補が最高スコアで選ばれる", () => {
    const t = track("ｔｏｍａｔｏ", "YAMADA TARO", 180);
    const c1 = candidate("zen", "ＴＯＭＡＴＯ", ["YAMADA TARO"], 180);
    const r = pickBest(t, [c1]);
    assert.equal(r.best.id, "zen");
    assert.equal(r.score, 100);
  });
});
