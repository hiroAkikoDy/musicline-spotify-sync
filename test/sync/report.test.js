import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { csvEscape, toCsv, buildSummary, buildReportText, writeReports } from "../../src/sync/report.js";

// attempts / plan のフィクスチャ
const trackOf = (title, artist, episodeId = "e1") => ({ title, artist, durationSec: 200, episodeId, airDate: "2026-10-01T21:45:00+09:00" });
const attemptOf = (track, maxScore, titleMatch, artistMatch, within, adopted) => ({
  track,
  maxScore,
  topCandidate: { id: `id-${titleMatch}-${artistMatch}-${maxScore}`, uri: "spotify:track:x", title: `SP-${titleMatch}`, artists: [`SP-${artistMatch}`], durationSec: 200 },
  titleMatch,
  artistMatch,
  durationWithin: within,
  usedFallback: false,
  adopted,
});
const planFixture = {
  episodesSelected: 2,
  totalTracks: 4,
  themeRemoved: 1,
  duplicates: 2,
  monthOrder: ["2026-09", "2026-10"],
  months: {
    "2026-09": [trackOf("曲A", "歌手A", "e1"), trackOf("曲B", "歌手B", "e1")],
    "2026-10": [trackOf("曲C", "歌手C", "e2"), trackOf("曲D", "歌手D", "e2")],
  },
};

function resultsFixture() {
  const attempts = [
    attemptOf(trackOf("曲A", "歌手A", "e1"), 100, "exact", "exact", true, true),   // 50/60/70 すべて採用
    attemptOf(trackOf("曲B", "歌手B", "e1"), 65, "partial", "exact", false, true), // 60までは採用・70では非採用(時間差12秒=外)
    attemptOf(trackOf("曲C", "歌手C", "e2"), 55, "exact", "none", false, true),    // アーティスト0点・50のみ採用
    attemptOf(trackOf("曲D", "歌手D", "e2"), 30, "none", "none", null, false),     // 常に未採用
  ];
  const results = {
    matched: [
      { track: attempts[0].track, candidate: attempts[0].topCandidate, score: 100, detail: { title: { score: 50, match: "exact" }, artist: { score: 40, match: "exact" }, duration: { score: 10, diffSec: 3 } }, usedFallback: false, fallbackMatched: false },
      { track: attempts[1].track, candidate: attempts[1].topCandidate, score: 65, detail: { title: { score: 25, match: "partial" }, artist: { score: 40, match: "exact" }, duration: { score: 0, diffSec: 12 } }, usedFallback: false, fallbackMatched: false },
      { track: attempts[2].track, candidate: attempts[2].topCandidate, score: 55, detail: { title: { score: 50, match: "exact" }, artist: { score: 0, match: "none" }, duration: { score: 0, diffSec: 9 } }, usedFallback: true, fallbackMatched: true },
    ],
    unmatched: [
      { track: attempts[3].track, bestCandidate: attempts[3].topCandidate, bestScore: 30, reason: "below_threshold", usedFallback: true },
    ],
    errors: [],
    attempts,
  };
  return { results, attempts };
}

describe("csvEscape / toCsv", () => {
  test("csvEscape: カンマ・引用符・改行を正しくエスケープする", () => {
    assert.equal(csvEscape("plain"), "plain");
    assert.equal(csvEscape("a,b"), '"a,b"');
    assert.equal(csvEscape('a"b'), '"a""b"');
    assert.equal(csvEscape("a\nb"), '"a\nb"');
    assert.equal(csvEscape('a,"b"'), '"a,""b"""');
  });
  test("toCsv: ヘッダー行とBOM付きUTF-8", async () => {
    const csv = toCsv(["a", "b"], [["1", "x,y"], ["2", 'q"r']]);
    assert.ok(csv.startsWith("\uFEFF")); // BOM
    const lines = csv.slice(1).split(/\r?\n/);
    assert.equal(lines[0], "a,b");
    assert.equal(lines[1], "1,\"x,y\"");
    assert.equal(lines[2], "2,\"q\"\"r\"");
  });
});

describe("buildSummary", () => {
  const { results } = resultsFixture();
  const summary = buildSummary({ plan: planFixture, results, minScore: 60, thresholds: [50, 60, 70] });

  test("マッチ率: matched / 検索対象。0件のときは0", () => {
    assert.equal(summary.matchedCount, 3);
    assert.equal(summary.unmatchedCount, 1);
    assert.equal(summary.searchedCount, 4);
    assert.equal(summary.matchRate, 0.75);
    const empty = buildSummary({ plan: { ...planFixture, totalTracks: 0, monthOrder: [], months: {} }, results: { matched: [], unmatched: [], errors: [], attempts: [] }, minScore: 60 });
    assert.equal(empty.matchRate, 0);
  });

  test("月別の件数と除外件数", () => {
    assert.deepEqual(summary.monthly, [
      { month: "2026-09", tracks: 2 },
      { month: "2026-10", tracks: 2 },
    ]);
    assert.equal(summary.episodesSelected, 2);
    assert.equal(summary.themeRemoved, 1);
    assert.equal(summary.duplicates, 2);
  });

  test("フォールバックでマッチした件数", () => {
    assert.equal(summary.fallbackMatched, 1);
  });

  test("採用理由の内訳(曲名×アーティスト×再生時間)を件数表にする", () => {
    const find = (t, a, d) => summary.breakdown.find((r) => r.title === t && r.artist === a && r.duration === d)?.count ?? 0;
    assert.equal(find("exact", "exact", "within"), 1);
    assert.equal(find("partial", "exact", "outside"), 1);
    assert.equal(find("exact", "none", "outside"), 1);
    assert.equal(summary.breakdown.reduce((a, r) => a + r.count, 0), 3); // matchedのみ対象
  });

  test("アーティスト点0で採用された曲の一覧", () => {
    assert.equal(summary.artistZero.length, 1);
    assert.equal(summary.artistZero[0].nhk.title, "曲C");
    assert.equal(summary.artistZero[0].spotify.title, "SP-exact"); // 曲名は一致
    assert.deepEqual(summary.artistZero[0].spotify.artists, ["SP-none"]); // アーティストのみ不一致
  });

  test("曲名が部分一致で採用された曲の一覧", () => {
    assert.equal(summary.partialTitles.length, 1);
    assert.equal(summary.partialTitles[0].nhk.title, "曲B");
    assert.equal(summary.partialTitles[0].score, 65);
  });

  test("閾値 50/60/70 での matched 件数と、結果が変わる曲の一覧", () => {
    assert.deepEqual(summary.thresholds, [
      { threshold: 50, matched: 3 },
      { threshold: 60, matched: 2 },
      { threshold: 70, matched: 1 },
    ]);
    // 50では採用・70では非採用になる曲 = 曲B(65) と 曲C(55)
    const changedTitles = summary.thresholdChanged.map((r) => r.track.title).sort();
    assert.deepEqual(changedTitles, ["曲B", "曲C"]);
  });

  test("CSV出力用の行が作られる", () => {
    assert.equal(summary.unmatchedRows.length, 2); // ヘッダー + 1曲
    assert.equal(summary.unmatchedRows[0][0], "episodeId");
    assert.equal(summary.matchedPreviewRows.length, 4); // ヘッダー + 3曲
  });
});

describe("buildReportText / writeReports", () => {
  test("レポート本文にマッチ率・月別件数・閾値比較が含まれる", () => {
    const { results } = resultsFixture();
    const summary = buildSummary({ plan: planFixture, results, minScore: 60, thresholds: [50, 60, 70] });
    const text = buildReportText(summary, { minScore: 60 });
    assert.match(text, /マッチ率/);
    assert.match(text, /2026-09/);
    assert.match(text, /フォールバック/);
    assert.match(text, /70/);
  });

  test("writeReports: out/unmatched.csv と out/matched_preview.csv をBOM付きで出力する", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sync-report-test-"));
    try {
      const { results } = resultsFixture();
      const summary = buildSummary({ plan: planFixture, results, minScore: 60, thresholds: [50, 60, 70] });
      await writeReports(summary, { outDir: dir });
      const unmatched = await readFile(join(dir, "unmatched.csv"), "utf8");
      const preview = await readFile(join(dir, "matched_preview.csv"), "utf8");
      assert.ok(unmatched.startsWith("\uFEFF"));
      assert.ok(preview.startsWith("\uFEFF"));
      assert.match(unmatched, /episodeId,airDate,title,artist,bestCandidate,bestScore,reason/);
      assert.match(preview, /nhkTitle/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
