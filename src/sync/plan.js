// 対象選定・月グルーピング（dry-run の計画を作る純粋関数）。
// - 曲を持つ回のみ対象（未来日・musicList空・フィールドなしは除外）
// - テーマ曲除外 → 重複排除（時系列で最初に出現した月に1回だけ）→ 放送月(JST)ごとにグルーピング
import { extractTracks, makeTrackKey } from "../nhk/normalize.js";
import { isThemeSong } from "../match/theme.js";

// ISO8601 日時を JST の暦日/月に変換する（"2026-09-30T15:00:00Z" → JST 2026-10-01）。
function jstParts(value) {
  const t = value instanceof Date ? value : new Date(value);
  if (!(t instanceof Date) || Number.isNaN(t.getTime())) return null;
  const j = new Date(t.getTime() + 9 * 60 * 60 * 1000);
  const y = j.getUTCFullYear();
  const m = String(j.getUTCMonth() + 1).padStart(2, "0");
  const d = String(j.getUTCDate()).padStart(2, "0");
  return { date: `${y}-${m}-${d}`, month: `${y}-${m}` };
}

export function buildPlan(episodesCache, { since, limit, includeTheme = false, now = new Date() } = {}) {
  const todayJst = jstParts(now)?.date ?? "9999-12-31";
  const eps =
    episodesCache && typeof episodesCache === "object" && episodesCache.episodes && typeof episodesCache.episodes === "object"
      ? Object.values(episodesCache.episodes)
      : [];

  // 曲を持つ回だけを集める
  const withTracks = [];
  for (const e of eps) {
    if (!e || typeof e !== "object") continue;
    const tracks = extractTracks(e);
    if (tracks.length === 0) continue;
    const jst = jstParts(e?.releasedEvent?.startDate);
    if (!jst) continue;
    if (jst.date > todayJst) continue; // 未来日
    if (since && jst.date < since) continue; // --since (JST 暦日比較)
    withTracks.push({ episode: e, tracks, jst });
  }

  // 新しい順に limit 回（limit は曲を持つ回のみカウント）
  const byNewest = (a, b) =>
    a.jst.date < b.jst.date ? 1 : a.jst.date > b.jst.date ? -1 : String(a.episode.id).localeCompare(String(b.episode.id));
  withTracks.sort(byNewest);
  const selected = Number.isInteger(limit) && limit > 0 ? withTracks.slice(0, limit) : withTracks;
  const episodesSelected = selected.length;

  // 時系列(古い順)でテーマ除外 → 重複排除 → 月ごとにグルーピング
  const chrono = [...selected].sort((a, b) => -byNewest(a, b));
  const months = {};
  let totalTracks = 0;
  let themeRemoved = 0;
  let duplicates = 0;
  const seen = new Set();
  for (const { tracks, jst } of chrono) {
    const filtered = includeTheme ? tracks : tracks.filter((t) => !isThemeSong(t));
    themeRemoved += tracks.length - filtered.length;
    for (const track of filtered) {
      const key = makeTrackKey(track.title, track.artist);
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      (months[jst.month] ??= []).push(track);
      totalTracks++;
    }
  }
  const monthOrder = Object.keys(months).sort();
  return { months, monthOrder, totalTracks, themeRemoved, duplicates, episodesSelected };
}
