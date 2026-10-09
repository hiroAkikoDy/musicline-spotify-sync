import { normalizeText } from "../nhk/normalize.js";

export const WEIGHTS = {
  TITLE_EXACT: 50,
  TITLE_PARTIAL: 25,
  TITLE_CORE_EXACT: 40,
  ARTIST_EXACT: 40,
  ARTIST_PARTIAL: 20,
  DURATION_WITHIN_5SEC: 10,
};

const DURATION_TOLERANCE_SEC = 5;

function norm(s) {
  return normalizeText(s).toLowerCase();
}

function coreTitle(s) {
  const t = norm(s).replace(/\([^)]*\)/g, " ").replace(/\s+-\s.*$/, " ");
  return normalizeText(t).toLowerCase();
}

function titleScore(trackTitle, candidateTitle) {
  const a = norm(trackTitle);
  const b = norm(candidateTitle);
  let match = "none";
  let score = 0;
  if (a && b && a === b) {
    match = "exact";
    score = WEIGHTS.TITLE_EXACT;
  } else if (a && b && (a.includes(b) || b.includes(a))) {
    match = "partial";
    score = WEIGHTS.TITLE_PARTIAL;
  }
  const ca = coreTitle(trackTitle);
  const cb = coreTitle(candidateTitle);
  if (ca && cb && ca === cb && WEIGHTS.TITLE_CORE_EXACT > score) {
    match = "core";
    score = WEIGHTS.TITLE_CORE_EXACT;
  }
  return { score, match };
}

function splitNames(value) {
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((s) => (typeof s === "string" ? s.split(",") : []))
    .map((s) => normalizeText(s).toLowerCase())
    .filter(Boolean);
}

function artistScore(trackArtist, candidateArtists) {
  const trackNames = splitNames(trackArtist);
  const candNames = splitNames(candidateArtists);
  let match = "none";
  let score = 0;
  for (const cand of candNames) {
    for (const name of trackNames) {
      if (cand === name) {
        return { score: WEIGHTS.ARTIST_EXACT, match: "exact" };
      }
      if (cand.includes(name) || name.includes(cand)) {
        match = "partial";
        score = WEIGHTS.ARTIST_PARTIAL;
      }
    }
  }
  return { score, match };
}

function durationScore(trackSec, candSec) {
  if (typeof trackSec !== "number" || typeof candSec !== "number") {
    return { score: 0, diffSec: null };
  }
  const diffSec = Math.abs(trackSec - candSec);
  return {
    score: diffSec <= DURATION_TOLERANCE_SEC ? WEIGHTS.DURATION_WITHIN_5SEC : 0,
    diffSec,
  };
}

export function scoreCandidate(track, candidate) {
  const title = titleScore(track?.title, candidate?.title);
  const artist = artistScore(track?.artist, candidate?.artists);
  const duration = durationScore(track?.durationSec, candidate?.durationSec);
  return {
    score: title.score + artist.score + duration.score,
    detail: { title, artist, duration },
  };
}
