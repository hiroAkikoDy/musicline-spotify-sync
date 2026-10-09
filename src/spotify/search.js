// Spotify検索ラッパ: buildQuery / searchTracks / searchWithFallback。
// 2026-02 Dev Mode 変更により検索の limit 上限は10 (デフォルト5)。上限は1箇所で定義し丸める。
// 候補の評価 (スコアリング) は行わない (3Aの責務)。応答の欠損フィールドでも落ちない。
import { normalizeText } from "../nhk/normalize.js";

export const MAX_SEARCH_LIMIT = 10;
export const DEFAULT_SEARCH_LIMIT = 10;
export const DEFAULT_MARKET = "JP";

// フィールドフィルタの値はダブルクォートで囲み、内側の " は \" にエスケープする。
// (スペース含みの曲名・アーティスト名の誤解釈と、追加フィルタ混入の両方を防ぐ)
function quoteValue(s) {
  return `"${s.replace(/"/g, '\\"')}"`;
}

// 検索語を組み立てる。title/artist は normalizeText (NFKC正規化) してから使う。
// 複数アーティスト (", " 区切り) は先頭1名のみ (全員を並べるとヒットしにくいため)。
export function buildQuery({ title, artist } = {}) {
  const t = normalizeText(title);
  if (!t) return "";
  const a = normalizeText(artist).split(",")[0].trim();
  return a ? `track:${quoteValue(t)} artist:${quoteValue(a)}` : `track:${quoteValue(t)}`;
}

// limit を [1, MAX_SEARCH_LIMIT] に丸める。無効値はデフォルト。
function clampLimit(limit) {
  const n = Math.trunc(Number(limit));
  if (!Number.isFinite(n)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(Math.max(n, 1), MAX_SEARCH_LIMIT);
}

function toDurationSec(ms) {
  if (ms === null || ms === undefined) return null;
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  return Math.round(n / 1000);
}

// GET /search で track を検索し Candidate[] を返す。spotifyFetch は createSpotifyClient の返す関数。
export async function searchTracks(spotifyFetch, { title, artist } = {}, opts = {}) {
  const q = buildQuery({ title, artist });
  if (!q) return [];
  const market = normalizeText(opts.market) || DEFAULT_MARKET;
  const params = new URLSearchParams({
    q,
    type: "track",
    limit: String(clampLimit(opts.limit)),
    market,
  });
  const data = await spotifyFetch(`/search?${params.toString()}`);
  const items = data?.tracks?.items;
  if (!Array.isArray(items)) return [];
  return items.map((it) => ({
    id: typeof it?.id === "string" ? it.id : "",
    uri: typeof it?.uri === "string" ? it.uri : "",
    title: typeof it?.name === "string" ? it.name : "",
    artists: Array.isArray(it?.artists)
      ? it.artists.map((a) => (typeof a?.name === "string" ? a.name : "")).filter(Boolean)
      : [],
    durationSec: toDurationSec(it?.duration_ms),
  }));
}

// 1回目は title+artist で検索。0件のときだけ artist 抜きで再検索する (usedFallback: true)。
// 「候補はあるが低スコア」のフォールバック判断は3C側の責務。ここでは0件のときだけ自動で再検索する。
export async function searchWithFallback(spotifyFetch, track, opts = {}) {
  const query = buildQuery(track);
  if (!query) return { candidates: [], usedFallback: false, query: "" };
  const candidates = await searchTracks(spotifyFetch, track, opts);
  if (candidates.length > 0 || !normalizeText(track?.artist)) {
    return { candidates, usedFallback: false, query };
  }
  const fallbackTrack = { ...track, artist: "" };
  const fallback = await searchTracks(spotifyFetch, fallbackTrack, opts);
  return { candidates: fallback, usedFallback: true, query: buildQuery(fallbackTrack) };
}
