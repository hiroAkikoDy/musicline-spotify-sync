// 結果の表示・CSV出力。ロジックの変更は行わない（3Aの採点結果の計測のみ）。
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// header: string[] / rows: string[][]。BOM付きUTF-8 (Excel対応)。
export function toCsv(header, rows) {
  const body = [header, ...rows].map((r) => r.map((c) => csvEscape(c)).join(",")).join("\r\n");
  return "\uFEFF" + body + "\r\n";
}

export function buildSummary({ plan, results, minScore = 60, thresholds = [50, 60, 70] } = {}) {
  const matched = results?.matched ?? [];
  const unmatched = results?.unmatched ?? [];
  const errors = results?.errors ?? [];
  const attempts = results?.attempts ?? [];
  const searchedCount = matched.length + unmatched.length;
  const matchRate = searchedCount === 0 ? 0 : matched.length / searchedCount;
  const fallbackMatched = matched.filter((m) => m.fallbackMatched).length;
  const monthly = (plan?.monthOrder ?? []).map((m) => ({ month: m, tracks: plan.months[m]?.length ?? 0 }));

  // 採用理由の内訳: 曲名 × アーティスト × 再生時間
  const breakdownMap = new Map();
  for (const a of attempts) {
    if (!a.adopted) continue;
    const duration = a.durationWithin == null ? "unknown" : a.durationWithin ? "within" : "outside";
    const key = `${a.titleMatch}|${a.artistMatch}|${duration}`;
    breakdownMap.set(key, (breakdownMap.get(key) ?? 0) + 1);
  }
  const breakdown = [...breakdownMap.entries()].map(([k, count]) => {
    const [title, artist, duration] = k.split("|");
    return { title, artist, duration, count };
  });

  // リスク分析用のリスト
  const artistZero = matched
    .filter((m) => m.detail?.artist?.score === 0)
    .map((m) => ({
      nhk: { title: m.track.title, artist: m.track.artist },
      spotify: { title: m.candidate.title, artists: m.candidate.artists },
      score: m.score,
      episodeId: m.track.episodeId,
    }));
  const partialTitles = matched
    .filter((m) => m.detail?.title?.match === "partial")
    .map((m) => ({
      nhk: { title: m.track.title, artist: m.track.artist },
      spotify: { title: m.candidate.title, artists: m.candidate.artists },
      score: m.score,
      episodeId: m.track.episodeId,
    }));

  // 閾値比較（再検索なし・計測済みスコアからの集計）
  const thresholds_ = thresholds ?? [];
  const thresholdsTable = thresholds_.map((t) => ({ threshold: t, matched: attempts.filter((a) => a.maxScore >= t).length }));
  const thresholdChanged = attempts
    .filter((a) => {
      const n = thresholds_.filter((t) => a.maxScore >= t).length;
      return n > 0 && n < thresholds_.length; // 閾値によって採否が変わる曲
    })
    .map((a) => ({ track: a.track, maxScore: a.maxScore, topCandidate: a.topCandidate }));

  const unmatchedRows = [
    ["episodeId", "airDate", "title", "artist", "bestCandidate", "bestScore", "reason"],
    ...unmatched.map((u) => [
      u.track.episodeId,
      u.track.airDate,
      u.track.title,
      u.track.artist,
      u.bestCandidate ? `${u.bestCandidate.title} / ${u.bestCandidate.artists.join(", ")}` : "",
      u.bestScore,
      u.reason,
    ]),
  ];
  const matchedPreviewRows = [
    ["month", "episodeId", "airDate", "nhkTitle", "nhkArtist", "spotifyTitle", "spotifyArtists", "score", "titleMatch", "artistMatch", "durationDiffSec", "usedFallback", "spotifyUri"],
    ...matched.map((m) => {
      const month = (plan?.monthOrder ?? []).find((mo) => (plan.months[mo] ?? []).some((t) => t.episodeId === m.track.episodeId && t.title === m.track.title && t.artist === m.track.artist)) ?? "";
      return [
        month,
        m.track.episodeId,
        m.track.airDate,
        m.track.title,
        m.track.artist,
        m.candidate.title,
        m.candidate.artists.join(", "),
        m.score,
        m.detail?.title?.match ?? "",
        m.detail?.artist?.match ?? "",
        m.detail?.duration?.diffSec ?? "",
        m.usedFallback ? "yes" : "no",
        m.candidate.uri,
      ];
    }),
  ];

  return {
    episodesSelected: plan?.episodesSelected ?? 0,
    totalTracks: plan?.totalTracks ?? 0,
    themeRemoved: plan?.themeRemoved ?? 0,
    duplicates: plan?.duplicates ?? 0,
    monthly,
    searchedCount,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    errorCount: errors.length,
    matchRate,
    fallbackMatched,
    breakdown,
    artistZero,
    partialTitles,
    thresholds: thresholdsTable,
    thresholdChanged,
    unmatchedRows,
    matchedPreviewRows,
  };
}

export function buildReportText(summary, { minScore = 60 } = {}) {
  const pct = (summary.matchRate * 100).toFixed(1);
  const lines = [];
  lines.push("=== sync dry-run レポート ===");
  lines.push(`対象エピソード: ${summary.episodesSelected}回 / 対象曲: ${summary.totalTracks}曲 (テーマ曲除外 ${summary.themeRemoved}件, 重複除外 ${summary.duplicates}件)`);
  lines.push("--- 月別 ---");
  for (const m of summary.monthly) lines.push(`${m.month}: ${m.tracks}曲`);
  lines.push("--- 結果 ---");
  lines.push(`minScore: ${minScore}`);
  lines.push(`検索対象: ${summary.searchedCount}曲 / マッチ: ${summary.matchedCount}曲 / 未マッチ: ${summary.unmatchedCount}曲 / エラー: ${summary.errorCount}曲`);
  lines.push(`マッチ率: ${pct}%`);
  lines.push(`フォールバックでマッチ: ${summary.fallbackMatched}曲`);
  lines.push("--- 採用理由の内訳 (曲名 × アーティスト × 再生時間) ---");
  if (summary.breakdown.length === 0) lines.push("(該当なし)");
  for (const b of summary.breakdown) {
    lines.push(`曲名=${b.title} × アーティスト=${b.artist} × 時間=${b.duration}: ${b.count}件`);
  }
  lines.push(`--- アーティスト点0で採用された曲 (${summary.artistZero.length}件) ---`);
  for (const r of summary.artistZero) lines.push(`- ${r.nhk.title} / ${r.nhk.artist} ↔ ${r.spotify.title} / ${r.spotify.artists.join(", ")} (${r.score}点)`);
  lines.push(`--- 曲名が部分一致で採用された曲 (${summary.partialTitles.length}件) ---`);
  for (const r of summary.partialTitles) lines.push(`- ${r.nhk.title} / ${r.nhk.artist} ↔ ${r.spotify.title} / ${r.spotify.artists.join(", ")} (${r.score}点)`);
  lines.push("--- 閾値比較 ---");
  lines.push(summary.thresholds.map((t) => `${t.threshold}点以上: ${t.matched}件`).join(" / "));
  lines.push(`閾値で採否が変わる曲: ${summary.thresholdChanged.length}件`);
  for (const r of summary.thresholdChanged) lines.push(`- ${r.track.title} / ${r.track.artist} (最高${r.maxScore}点)`);
  return lines.join("\n");
}

export function printReport(summary, opts) {
  console.log(buildReportText(summary, opts));
}

export async function writeReports(summary, { outDir = "out" } = {}) {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "unmatched.csv"), toCsv(summary.unmatchedRows[0], summary.unmatchedRows.slice(1)));
  await writeFile(join(outDir, "matched_preview.csv"), toCsv(summary.matchedPreviewRows[0], summary.matchedPreviewRows.slice(1)));
}
