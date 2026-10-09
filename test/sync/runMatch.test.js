import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runMatch } from "../../src/sync/runMatch.js";

// Spotify形式の検索応答を返すモック spotifyFetch。
// 注意: spotifyFetch の契約は「解析済みJSONを返す」(createSpotifyClient が res.json() 済みのため)。
// ルーティングは URLSearchParams が ":" を "%3A" にエンコードするため decodeURIComponent して判定する。
const item = (id, name, artists, ms) => ({ id, uri: `spotify:track:${id}`, name, artists: artists.map((a) => ({ name: a })), duration_ms: ms });

function mockFetch({ withArtist = [], titleOnly = [] } = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      const decoded = decodeURIComponent(url);
      return decoded.includes("artist:")
        ? { tracks: { items: withArtist } }
        : { tracks: { items: titleOnly } };
    },
  };
}

const track = { title: "Imagine", artist: "John Lennon", durationSec: 185, episodeId: "e1", airDate: "2026-10-01T21:45:00+09:00" };
const sleepSpy = () => {
  const calls = [];
  return { calls, sleepImpl: async (ms) => calls.push(ms) };
};

describe("runMatch", () => {
  test("ベスト候補を採用する(matched)。スコア・フォールバック無し", async () => {
    const m = mockFetch({ withArtist: [item("id1", "Imagine", ["John Lennon"], 185000)] });
    const r = await runMatch([track], m.fetch, { sleepImpl: async () => {} });
    assert.equal(r.matched.length, 1);
    assert.equal(r.unmatched.length, 0);
    assert.equal(r.matched[0].candidate.id, "id1");
    assert.equal(r.matched[0].score, 100); // 曲名50 + アーティスト40 + 時間10
    assert.equal(r.matched[0].usedFallback, false);
    assert.equal(r.attempts[0].adopted, true);
    assert.equal(r.attempts[0].maxScore, 100);
  });

  test("title+artist で0件 → title のみで再検索して救済(usedFallback)", async () => {
    const m = mockFetch({ withArtist: [], titleOnly: [item("id2", "Imagine", ["John Lennon"], 186000)] });
    const s = sleepSpy();
    const r = await runMatch([track], m.fetch, { sleepImpl: s.sleepImpl });
    assert.equal(r.matched.length, 1);
    assert.equal(r.matched[0].usedFallback, true);
    assert.equal(r.matched[0].fallbackMatched, true);
    assert.equal(r.matched[0].candidate.id, "id2");
    assert.equal(m.calls.length, 2); // artist付き → artist抜き
    assert.ok(decodeURIComponent(m.calls[0]).includes("artist:"));
    assert.ok(!decodeURIComponent(m.calls[1]).includes("artist:"));
    assert.deepEqual(s.calls, [500]); // 再検索前のsleepのみ(曲は1件)
  });

  test("両方0件なら unmatched (reason: no_candidates)", async () => {
    const m = mockFetch({ withArtist: [], titleOnly: [] });
    const r = await runMatch([track], m.fetch, { sleepImpl: async () => {} });
    assert.equal(r.matched.length, 0);
    assert.equal(r.unmatched.length, 1);
    assert.equal(r.unmatched[0].reason, "no_candidates");
    assert.equal(r.unmatched[0].usedFallback, true);
    assert.equal(r.attempts[0].adopted, false);
  });

  test("候補はあるが閾値未満なら unmatched (reason: below_threshold, 最高スコア候補を記録)", async () => {
    const m = mockFetch({ withArtist: [item("id9", "Totally Different Song", ["Other Artist"], 200000)] });
    const r = await runMatch([track], m.fetch, { minScore: 60, sleepImpl: async () => {} });
    assert.equal(r.matched.length, 0);
    assert.equal(r.unmatched.length, 1);
    assert.equal(r.unmatched[0].reason, "below_threshold");
    assert.equal(r.unmatched[0].bestCandidate.id, "id9");
    assert.ok(r.unmatched[0].bestScore < 60);
  });

  test("1回目が低スコアでも、フォールバック先で高スコアなら採用する", async () => {
    const m = mockFetch({
      withArtist: [item("bad", "Imagine Dragons Style", ["Imagine Dragons"], 210000)], // 曲名partialのみ
      titleOnly: [item("good", "Imagine", ["John Lennon"], 185000)],
    });
    const r = await runMatch([track], m.fetch, { sleepImpl: async () => {} });
    assert.equal(r.matched.length, 1);
    assert.equal(r.matched[0].candidate.id, "good");
    assert.equal(r.matched[0].usedFallback, true);
    assert.equal(r.matched[0].fallbackMatched, true);
  });

  test("1曲の例外で全体を止めず、エラー記録して続行する", async () => {
    const t2 = { title: "曲B", artist: "歌手B", durationSec: 200, episodeId: "e2", airDate: "2026-10-02T21:45:00+09:00" };
    let artistCalls = 0;
    const m2 = {
      calls: [],
      fetch: async (url) => {
        m2.calls.push(url);
        if (decodeURIComponent(url).includes("artist:")) {
          artistCalls++;
          if (artistCalls === 1) throw new Error("network down"); // 1曲目の artist 付き検索だけ失敗
          return { tracks: { items: [item("idB", "曲B", ["歌手B"], 200000)] } };
        }
        return { tracks: { items: [] } };
      },
    };
    const r = await runMatch([track, t2], m2.fetch, { sleepImpl: async () => {} });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].error, /network down/);
    assert.equal(r.errors[0].track.title, "Imagine");
    assert.equal(r.matched.length, 1);
    assert.equal(r.matched[0].track.title, "曲B");
    assert.equal(m2.calls.length, 2); // track1: artist付き(throw・フォールバックせず), track2: artist付き(成功)
  });

  test("曲と曲の間で500ms以上のsleepを挟む(初回曲の前は無し)", async () => {
    const m = mockFetch({ withArtist: [item("id1", "Imagine", ["John Lennon"], 185000)] });
    const s = sleepSpy();
    await runMatch([track, { ...track, episodeId: "e2" }], m.fetch, { sleepImpl: s.sleepImpl });
    assert.deepEqual(s.calls, [500]);
  });

  test("attempts に全曲の計測情報が入る", async () => {
    const m = mockFetch({ withArtist: [item("id1", "Imagine", ["John Lennon"], 185000)] });
    const r = await runMatch([track], m.fetch, { sleepImpl: async () => {} });
    assert.equal(r.attempts.length, 1);
    assert.equal(r.attempts[0].titleMatch, "exact");
    assert.equal(r.attempts[0].artistMatch, "exact");
    assert.equal(r.attempts[0].durationWithin, true);
  });
});
