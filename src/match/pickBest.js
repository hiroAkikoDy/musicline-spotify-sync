import { scoreCandidate } from "./score.js";

export const MIN_SCORE_DEFAULT = 60;

export function pickBest(track, candidates, { minScore = MIN_SCORE_DEFAULT } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  let bestIdx = -1;
  let runnerIdx = -1;
  let bestResult = null;
  let runnerResult = null;
  for (let i = 0; i < list.length; i++) {
    const result = scoreCandidate(track, list[i]);
    if (!bestResult || result.score > bestResult.score) {
      runnerIdx = bestIdx;
      runnerResult = bestResult;
      bestIdx = i;
      bestResult = result;
    } else if (!runnerResult || result.score > runnerResult.score) {
      runnerIdx = i;
      runnerResult = result;
    }
  }
  return {
    best: bestResult && bestResult.score >= minScore ? list[bestIdx] : null,
    score: bestResult ? bestResult.score : 0,
    detail: bestResult ? bestResult.detail : null,
    runnerUp: runnerIdx >= 0 ? list[runnerIdx] : null,
  };
}
