import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate } from "../../src/match/score.js";

function track(title, artist, durationSec = null) {
  return { title, artist, durationSec, episodeId: "ep1", airDate: "2026-10-05" };
}
function candidate(title, artists, durationSec = null) {
  return { id: "c1", uri: "spotify:track:c1", title, artists, durationSec };
}

describe("scoreCandidate: 曲名", () => {
  test("完全一致 +50 (全角英数 ｔｏｍａｔｏ を含む)", () => {
    const r = scoreCandidate(track("ｔｏｍａｔｏ", "山田太郎"), candidate("TOMATO", ["鈴木花子"]));
    assert.equal(r.detail.title.score, 50);
    assert.equal(r.detail.title.match, "exact");
  });
  test("部分一致(片方が他方を含む) +25", () => {
    const r = scoreCandidate(track("Tomato Soup", "山田太郎"), candidate("Tomato", ["鈴木花子"]));
    assert.equal(r.detail.title.score, 25);
    assert.equal(r.detail.title.match, "partial");
  });
  test("コア曲名一致 +40 (括弧と - 以降の差を無視)", () => {
    const r = scoreCandidate(
      track("Imagine (Remastered 2010)", "John Lennon"),
      candidate("Imagine - Live", ["John Lennon"]),
    );
    assert.equal(r.detail.title.score, 40);
    assert.equal(r.detail.title.match, "core");
  });
  test("完全一致 +50 がコア一致 +40 より優先", () => {
    const r = scoreCandidate(track("Imagine", "John Lennon"), candidate("Imagine", ["John Lennon"]));
    assert.equal(r.detail.title.score, 50);
    assert.equal(r.detail.title.match, "exact");
  });
  test("全角括弧のコア曲名一致", () => {
    const r = scoreCandidate(track("ｔｏｍａｔｏ（Ｌｉｖｅ）", "山田太郎"), candidate("Tomato", ["鈴木花子"]));
    assert.equal(r.detail.title.score, 40);
    assert.equal(r.detail.title.match, "core");
  });
  test("不一致 0", () => {
    const r = scoreCandidate(track("Apple", "山田太郎"), candidate("Orange", ["鈴木花子"]));
    assert.equal(r.detail.title.score, 0);
    assert.equal(r.detail.title.match, "none");
  });
});

describe("scoreCandidate: アーティスト", () => {
  test("完全一致 +40", () => {
    const r = scoreCandidate(track("Tomato", "YAMADA TARO"), candidate("Tomato", ["yamada taro"]));
    assert.equal(r.detail.artist.score, 40);
    assert.equal(r.detail.artist.match, "exact");
  });
  test("部分一致 +20", () => {
    const r = scoreCandidate(track("Tomato", "YAMADA TARO"), candidate("Tomato", ["YAMADA TARO Jr."]));
    assert.equal(r.detail.artist.score, 20);
    assert.equal(r.detail.artist.match, "partial");
  });
  test("不一致 0", () => {
    const r = scoreCandidate(track("Tomato", "山田太郎"), candidate("Tomato", ["鈴木花子"]));
    assert.equal(r.detail.artist.score, 0);
    assert.equal(r.detail.artist.match, "none");
  });
  test("track.artist を , 区切りで分割しいずれかと一致 +40", () => {
    const r = scoreCandidate(
      track("Tomato", "YAMADA TARO, SUZUKI HANAKO"),
      candidate("Tomato", ["suzuki hanako"]),
    );
    assert.equal(r.detail.artist.score, 40);
    assert.equal(r.detail.artist.match, "exact");
  });
});

describe("scoreCandidate: 再生時間", () => {
  test("差が5秒ちょうど -> +10", () => {
    const r = scoreCandidate(track("T", "A", 180), candidate("T", ["A"], 185));
    assert.equal(r.detail.duration.score, 10);
  });
  test("差が6秒 -> 0", () => {
    const r = scoreCandidate(track("T", "A", 180), candidate("T", ["A"], 186));
    assert.equal(r.detail.duration.score, 0);
  });
  test("track.durationSec が null -> 0", () => {
    const r = scoreCandidate(track("T", "A", null), candidate("T", ["A"], 185));
    assert.equal(r.detail.duration.score, 0);
  });
  test("candidate.durationSec が null -> 0", () => {
    const r = scoreCandidate(track("T", "A", 180), candidate("T", ["A"], null));
    assert.equal(r.detail.duration.score, 0);
  });
});

describe("scoreCandidate: 合計", () => {
  test("曲名・アーティスト完全一致+時間差4秒で 50+40+10=100", () => {
    const r = scoreCandidate(track("ｔｏｍａｔｏ", "西岡大貴", 200), candidate("TOMATO", ["西岡大貴"], 196));
    assert.equal(r.score, 100);
  });
  test("曲名部分+アーティスト部分+時間なしで 25+20=45", () => {
    const r = scoreCandidate(track("Tomato Soup", "YAMADA TARO"), candidate("Tomato", ["YAMADA TARO JR."]));
    assert.equal(r.detail.title.score, 25);
    assert.equal(r.detail.artist.score, 20);
    assert.equal(r.score, 45);
  });
});
