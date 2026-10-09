import { normalizeText } from "../nhk/normalize.js";

const THEME_TITLE = "new point";
const THEME_ARTIST = "西岡大貴";

export function isThemeSong(track) {
  const title = normalizeText(track?.title).toLowerCase();
  const artist = normalizeText(track?.artist);
  return title === THEME_TITLE && artist.includes(THEME_ARTIST);
}

export function filterThemeSongs(tracks, { includeTheme = false } = {}) {
  if (!Array.isArray(tracks)) return [];
  if (includeTheme) return [...tracks];
  return tracks.filter((t) => !isThemeSong(t));
}
