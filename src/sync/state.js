// state.json（処理済みエピソード・追加済み曲・月別プレイリストID）の管理。
// version 1 スキーマ。壊れたJSON・未知versionは例外とし、自動上書きしない（データ消失防止）。
// 更新関数はすべて純粋（入力を破壊せず新しい state を返す）。
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { makeTrackKey } from "../nhk/normalize.js";

export const STATE_VERSION = 1;
const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;

export function initialState(now = new Date()) {
  return {
    version: STATE_VERSION,
    updatedAt: now.toISOString(),
    playlists: {},
    tracks: {},
    episodes: {},
    unmatched: [],
  };
}

function assertMonth(month) {
  if (typeof month !== "string" || !MONTH_RE.test(month)) {
    throw new Error(`month は YYYY-MM 形式で指定してください: ${JSON.stringify(month)}`);
  }
}

// state.json を読み込む。無ければ空の初期状態。
// 壊れたJSON・未知versionは例外（メッセージにパスと手動確認の案内を含む）。ファイルは上書きしない。
export async function loadState(path = "data/state.json") {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return initialState();
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`state.json が壊れています (${path}): JSONとして解釈できません (${err?.message ?? err})。ファイルを手動で確認・修復してください。自動上書きはしません。`);
  }
  if (!parsed || typeof parsed !== "object" || parsed.version !== STATE_VERSION) {
    throw new Error(`state.json の version が未知または不正です (${path}): version=${JSON.stringify(parsed?.version)}。対応バージョンは ${STATE_VERSION} です。ファイルを手動で確認してください。自動上書きはしません。`);
  }
  return {
    version: parsed.version,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    playlists: parsed.playlists && typeof parsed.playlists === "object" ? parsed.playlists : {},
    tracks: parsed.tracks && typeof parsed.tracks === "object" ? parsed.tracks : {},
    episodes: parsed.episodes && typeof parsed.episodes === "object" ? parsed.episodes : {},
    unmatched: Array.isArray(parsed.unmatched) ? parsed.unmatched : [],
  };
}

// 一時ファイル → rename の原子的書き込み。updatedAt を更新して保存し、保存後の state を返す。
export async function saveState(state, path = "data/state.json") {
  if (!state || typeof state !== "object") {
    throw new Error("saveState: state はオブジェクトである必要があります");
  }
  const next = { ...state, version: STATE_VERSION, updatedAt: new Date().toISOString() };
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(next, null, 1)}\n`, "utf8");
  await rename(tmp, path);
  return next;
}

// 月別プレイリストIDを登録する。再設定しても createdAt は保持。
export function setPlaylist(state, month, { id, name = "" } = {}) {
  assertMonth(month);
  if (typeof id !== "string" || id === "") {
    throw new Error(`setPlaylist: id は必須です (month=${month})`);
  }
  const playlists = { ...(state?.playlists ?? {}) };
  playlists[month] = {
    id,
    name,
    createdAt: playlists[month]?.createdAt ?? new Date().toISOString(),
  };
  return { ...state, playlists };
}

export function getPlaylist(state, month) {
  return state?.playlists?.[month] ?? null;
}

// 追加済み曲を記録する。entry は { key, uri, month, episodeId } または { title, artist, uri, month, episodeId }。
// key を省略した場合は makeTrackKey(title, artist) で計算する。既に key がある場合は先勝ちで無視。
export function recordTracks(state, entries) {
  const tracks = { ...(state?.tracks ?? {}) };
  for (const e of entries ?? []) {
    if (!e || typeof e !== "object") {
      throw new Error("recordTracks: entry はオブジェクトである必要があります");
    }
    assertMonth(e.month);
    const key = typeof e.key === "string" && e.key !== "" ? e.key : makeTrackKey(e.title, e.artist);
    if (typeof key !== "string" || key === "" || key === "|") {
      throw new Error("recordTracks: key（または title/artist）は必須です");
    }
    if (typeof e.uri !== "string" || e.uri === "") {
      throw new Error(`recordTracks: uri は必須です (key=${key})`);
    }
    if (Object.prototype.hasOwnProperty.call(tracks, key)) continue; // 先勝ち
    tracks[key] = {
      uri: e.uri,
      month: e.month,
      episodeId: typeof e.episodeId === "string" ? e.episodeId : "",
      addedAt: new Date().toISOString(),
    };
  }
  return { ...state, tracks };
}

export function hasTrack(state, key) {
  return Boolean(state?.tracks && Object.prototype.hasOwnProperty.call(state.tracks, key));
}

export function markEpisode(state, episodeId, { matched = 0, unmatched = 0 } = {}) {
  if (typeof episodeId !== "string" || episodeId === "") {
    throw new Error("markEpisode: episodeId は必須です");
  }
  const episodes = { ...(state?.episodes ?? {}) };
  episodes[episodeId] = {
    processedAt: new Date().toISOString(),
    matched: Number.isFinite(matched) ? matched : 0,
    unmatched: Number.isFinite(unmatched) ? unmatched : 0,
  };
  return { ...state, episodes };
}

export function isEpisodeProcessed(state, episodeId) {
  return Boolean(state?.episodes && Object.prototype.hasOwnProperty.call(state.episodes, episodeId));
}

// 未マッチ曲を記録する。同一 episodeId+title+artist は重複して積まない。
export function recordUnmatched(state, items) {
  const list = [...(state?.unmatched ?? [])];
  const seen = new Set(list.map((u) => `${u?.episodeId}\n${u?.title}\n${u?.artist}`));
  for (const it of items ?? []) {
    if (!it || typeof it !== "object") continue;
    const key = `${it.episodeId ?? ""}\n${it.title ?? ""}\n${it.artist ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    list.push({
      episodeId: typeof it.episodeId === "string" ? it.episodeId : "",
      airDate: typeof it.airDate === "string" ? it.airDate : "",
      title: typeof it.title === "string" ? it.title : "",
      artist: typeof it.artist === "string" ? it.artist : "",
    });
  }
  return { ...state, unmatched: list };
}
