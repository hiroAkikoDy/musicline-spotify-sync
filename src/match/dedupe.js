import { makeTrackKey } from "../nhk/normalize.js";

export function dedupeTracks(tracks) {
  const unique = [];
  const seen = new Set();
  let duplicates = 0;
  for (const t of Array.isArray(tracks) ? tracks : []) {
    const key = makeTrackKey(t?.title, t?.artist);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    unique.push(t);
  }
  return { unique, duplicates };
}
