import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { extractTracks } from "../../src/nhk/normalize.js";

const ep = (musicList) => ({
  id: "EP1",
  name: "ゲスト名",
  releasedEvent: { startDate: "2026-10-07T21:45:00+09:00" },
  detailedRecentEvent: { misc: { musicList } },
});

describe("extractTracks", () => {
  test("正常: musicListをトラック配列に変換", () => {
    const tracks = extractTracks(ep([
      { name: "曲A", duration: "PT4M54S", byArtist: [{ name: "歌手X" }] },
      { name: "曲B", duration: "PT3M", byArtist: [{ name: "歌手Y" }, { name: "歌手Z" }] },
    ]));
    assert.deepEqual(tracks, [
      { title: "曲A", artist: "歌手X", durationSec: 294, episodeId: "EP1", airDate: "2026-10-07T21:45:00+09:00" },
      { title: "曲B", artist: "歌手Y, 歌手Z", durationSec: 180, episodeId: "EP1", airDate: "2026-10-07T21:45:00+09:00" },
    ]);
  });
  test("全角はNFKC正規化される", () => {
    const tracks = extractTracks(ep([
      { name: "ｔｏｍａｔｏ", duration: "PT45S", byArtist: [{ name: "ＡＢＣ" }] },
    ]));
    assert.equal(tracks[0].title, "tomato");
    assert.equal(tracks[0].artist, "ABC");
  });
  test("musicListが空配列 -> []", () => {
    assert.deepEqual(extractTracks(ep([])), []);
  });
  test("musicListフィールドなし -> []", () => {
    assert.deepEqual(extractTracks({ id: "EP2" }), []);
    assert.deepEqual(extractTracks(null), []);
  });
  test("byArtist欠損 -> artist空文字", () => {
    const tracks = extractTracks(ep([{ name: "曲C", duration: "PT1M" }]));
    assert.deepEqual(tracks, [
      { title: "曲C", artist: "", durationSec: 60, episodeId: "EP1", airDate: "2026-10-07T21:45:00+09:00" },
    ]);
  });
  test("musicListが配列でない -> []", () => {
    assert.deepEqual(extractTracks(ep("だめ")), []);
    assert.deepEqual(extractTracks(ep(42)), []);
  });
});
