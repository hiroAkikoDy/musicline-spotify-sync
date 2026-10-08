// 曲名・アーティスト名の正規化と、エピソードからの曲抽出。
import { parseIsoDuration } from "./duration.js";

// NFKC正規化 → 前後trim → 連続空白を1つに。非文字列は空文字。
export function normalizeText(s) {
  if (typeof s !== "string") return "";
  return s.normalize("NFKC").trim().replace(/\s+/g, " ");
}

// 重複排除キー: 正規化後・小文字化した "title|artist"。
export function makeTrackKey(title, artist) {
  return `${normalizeText(title).toLowerCase()}|${normalizeText(artist).toLowerCase()}`;
}

function joinArtists(byArtist) {
  if (!Array.isArray(byArtist)) return "";
  return byArtist
    .map((a) => normalizeText(a?.name))
    .filter(Boolean)
    .join(", ");
}

// 1エピソードから [{ title, artist, durationSec, episodeId, airDate }] を返す純粋関数。
// musicList が空 / 無い / 配列でない場合は []。title・artist は正規化済みで返す。
export function extractTracks(episode) {
  const musicList = episode?.detailedRecentEvent?.misc?.musicList;
  if (!Array.isArray(musicList)) return [];
  const episodeId = typeof episode?.id === "string" ? episode.id : "";
  const airDate = typeof episode?.releasedEvent?.startDate === "string" ? episode.releasedEvent.startDate : "";
  const tracks = [];
  for (const item of musicList) {
    tracks.push({
      title: normalizeText(item?.name),
      artist: joinArtists(item?.byArtist),
      durationSec: parseIsoDuration(item?.duration),
      episodeId,
      airDate,
    });
  }
  return tracks;
}
