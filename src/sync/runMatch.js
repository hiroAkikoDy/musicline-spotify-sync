// 検索 → 採点 → 結果集計。1曲の失敗（例外）で全体を止めない。
// - ベストが null（低スコア）または候補0件のとき、artist 抜きで再検索して再度 pickBest
// - リクエスト間は sleepMs（既定500ms）以上あける
import { searchTracks } from "../spotify/search.js";
import { pickBest, MIN_SCORE_DEFAULT } from "../match/pickBest.js";
import { scoreCandidate } from "../match/score.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runMatch(tracks, spotifyFetch, { minScore = MIN_SCORE_DEFAULT, sleepMs = 500, sleepImpl = sleep } = {}) {
  const matched = [];
  const unmatched = [];
  const errors = [];
  const attempts = [];
  const list = Array.isArray(tracks) ? tracks : [];

  for (let i = 0; i < list.length; i++) {
    const track = list[i];
    if (i > 0) await sleepImpl(sleepMs);
    try {
      let usedFallback = false;
      let secondIds = new Set();
      let bestSeen = null; // { candidate, score, detail } — 試した全候補の最高スコア
      const consider = (candidates) => {
        for (const c of candidates ?? []) {
          const s = scoreCandidate(track, c);
          if (!bestSeen || s.score > bestSeen.score) bestSeen = { candidate: c, score: s.score, detail: s.detail };
        }
      };

      let candidates = await searchTracks(spotifyFetch, { title: track?.title, artist: track?.artist });
      consider(candidates);
      let adopted = null;
      if (candidates.length > 0) {
        const r = pickBest(track, candidates, { minScore });
        if (r.best) adopted = { candidate: r.best, score: r.score, detail: r.detail };
      }
      if (!adopted) {
        // 候補0件 または 低スコア → title のみで再検索
        await sleepImpl(sleepMs);
        usedFallback = true;
        candidates = await searchTracks(spotifyFetch, { title: track?.title });
        for (const c of candidates ?? []) secondIds.add(c.id);
        consider(candidates);
        if (candidates.length > 0) {
          const r = pickBest(track, candidates, { minScore });
          if (r.best) adopted = { candidate: r.best, score: r.score, detail: r.detail };
        }
      }

      const titleMatch = bestSeen?.detail?.title?.match ?? "none";
      const artistMatch = bestSeen?.detail?.artist?.match ?? "none";
      const diffSec = bestSeen?.detail?.duration?.diffSec;
      const durationWithin = diffSec == null ? null : diffSec <= 5;
      attempts.push({
        track,
        maxScore: bestSeen?.score ?? 0,
        topCandidate: bestSeen?.candidate ?? null,
        titleMatch,
        artistMatch,
        durationWithin,
        usedFallback,
        adopted: Boolean(adopted),
      });

      if (adopted) {
        matched.push({
          track,
          candidate: adopted.candidate,
          score: adopted.score,
          detail: adopted.detail,
          usedFallback,
          fallbackMatched: usedFallback && secondIds.has(adopted.candidate.id),
        });
      } else {
        unmatched.push({
          track,
          bestCandidate: bestSeen?.candidate ?? null,
          bestScore: bestSeen?.score ?? 0,
          reason: bestSeen ? "below_threshold" : "no_candidates",
          usedFallback,
        });
      }
    } catch (err) {
      errors.push({ track, error: String(err?.message ?? err) });
    }
  }

  return { matched, unmatched, errors, attempts };
}
