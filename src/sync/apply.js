// sync の書き込み実行（初めて実プレイリストを変更する経路）。
// 原則:
// - Spotify側の真実が常に優先。追加済み判定は state でなく listPlaylistUris の読み直しで行う
// - state は段階的に保存し（作成直後・月ごと・失敗時）、再実行で続きから再開できる
// - 削除系APIは使わない。触るのは state が持つ（または自分で作った）プレイリストIDのみ
import { buildPlan } from "./plan.js";
import { runMatch } from "./runMatch.js";
import { saveState, setPlaylist, getPlaylist, recordTracks, hasTrack, markEpisode, isEpisodeProcessed, recordUnmatched } from "./state.js";
import { makeTrackKey } from "../nhk/normalize.js";
import { MIN_SCORE_DEFAULT } from "../match/pickBest.js";
import { createPlaylist, listPlaylistUris, addTrackUris, ensureNotAlreadyAdded } from "../spotify/playlist.js";

const PLAYLIST_NAME_PREFIX = "\u30DF\u30E5\u30FC\u30B8\u30C3\u30AF\u30E9\u30A4\u30F3"; // ミュージックライン
const playlistName = (month) => `${PLAYLIST_NAME_PREFIX} ${month}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 書き込みを実行する。
// - state の isEpisodeProcessed の回は対象から外す
// - hasTrack(makeTrackKey) の曲は検索しない（検索API節約）
// - ベストが null / 候補0件のときの再検索は runMatch に任せる
// - 月ごとに: プレイリストが無ければ作成して直後に保存 → listPlaylistUris で実内容を取得 →
//   ensureNotAlreadyAdded で重複を除いて addTrackUris → 実際に存在する曲だけを recordTracks → 保存
// - 例外時はそれまでに成功した分の state を保存してから再スロー（呼び出し側が終了コード1にする）
export async function applySync({
  cache,
  state,
  statePath = "data/state.json",
  spotifyFetch,
  playlist = { createPlaylist, listPlaylistUris, addTrackUris },
  opts = {},
  yes = false,
  confirm = null,
  logger = console,
  sleepMs = 500,
  sleepImpl = sleep,
} = {}) {
  const minScore = opts?.minScore ?? MIN_SCORE_DEFAULT;

  // 処理済みの回を対象から外す
  const episodes = cache && typeof cache === "object" && cache.episodes ? cache.episodes : {};
  const remainingEpisodes = {};
  let skippedEpisodes = 0;
  for (const [id, ep] of Object.entries(episodes)) {
    if (isEpisodeProcessed(state, id)) {
      skippedEpisodes++;
      continue;
    }
    remainingEpisodes[id] = ep;
  }

  // 計画（plan）→ 追加済みの曲を除外
  const plan = buildPlan({ episodes: remainingEpisodes }, {
    limit: opts?.limit,
    since: opts?.since,
    includeTheme: opts?.includeTheme === true,
  });
  const tracks = plan.monthOrder.flatMap((m) => plan.months[m] ?? []);
  const remainingTracks = tracks.filter((t) => !hasTrack(state, makeTrackKey(t.title, t.artist)));
  const skippedTracks = tracks.length - remainingTracks.length;

  // 検索・採点（読み取りのみ）
  const results = await runMatch(remainingTracks, spotifyFetch, { minScore, sleepMs, sleepImpl });

  // episodeId → 放送月(JST) の対応
  const episodeMonth = {};
  for (const month of plan.monthOrder) {
    for (const t of plan.months[month] ?? []) episodeMonth[t.episodeId] = month;
  }
  const matchedByMonth = new Map();
  for (const m of results.matched) {
    const month = episodeMonth[m.track.episodeId];
    if (month == null) continue;
    if (!matchedByMonth.has(month)) matchedByMonth.set(month, []);
    matchedByMonth.get(month).push(m);
  }

  // 確認用の計画表示（マッチング後の実測値）
  const preview = buildPreview({ plan, matchedByMonth, state, minScore });

  // 書き込み直前の確認（--yes で省略）
  if (yes !== true && typeof confirm === "function") {
    const okToWrite = await confirm(preview);
    if (!okToWrite) {
      return { ok: false, cancelled: true, preview, summary: null };
    }
  }

  const summary = {
    created: [],
    addedByMonth: {},
    addedTotal: 0,
    skipped: { processedEpisodes: skippedEpisodes, existingTracks: skippedTracks },
    unmatchedCount: results.unmatched.length,
    errorCount: results.errors.length,
    months: [],
  };
  const writeErrors = [];

  for (const month of plan.monthOrder) {
    const ms = matchedByMonth.get(month) ?? [];
    if (ms.length === 0) continue; // 追加する曲がない月は触らない
    try {
      let p = getPlaylist(state, month);
      if (!p) {
        const created = await playlist.createPlaylist(spotifyFetch, {
          name: playlistName(month),
          description: "",
          isPublic: false,
        });
        state = setPlaylist(state, month, { id: created.id, name: created.name });
        state = await saveState(state, statePath); // 作成直後に保存（中断に強い）
        p = getPlaylist(state, month);
        summary.created.push({ month, id: created.id, name: created.name });
        logger.log?.(`プレイリストを作成しました: ${created.name} (${created.id})`);
      }

      // Spotify側の真実を取得して重複を除く（state失亡時の二重追加防止）
      const existing = await playlist.listPlaylistUris(spotifyFetch, p.id);
      const candUris = ms.map((m) => m.candidate.uri);
      const toAdd = ensureNotAlreadyAdded(existing, candUris);
      let addedNow = 0;
      if (toAdd.length > 0) {
        try {
          await playlist.addTrackUris(spotifyFetch, p.id, toAdd);
          addedNow = toAdd.length;
        } catch (err) {
          // added から推測しない。実際のプレイリストを読み直して、存在する曲だけを state に記録する
          let nowUris = new Set();
          try {
            nowUris = new Set(await playlist.listPlaylistUris(spotifyFetch, p.id));
          } catch {
            /* 読み直しに失敗した場合は何も記録しない（次回の再読み取りに委ねる） */
          }
          const present = candUris.filter((u) => nowUris.has(u));
          state = recordTracks(state, entriesFor(month, ms, present));
          state = await saveState(state, statePath);
          throw err;
        }
      }

      // 成功・既存を問わず、実際にプレイリストに存在する曲を state に記録（再検索を防ぐ）
      const nowSet = new Set(await playlist.listPlaylistUris(spotifyFetch, p.id));
      state = recordTracks(state, entriesFor(month, ms, candUris.filter((u) => nowSet.has(u))));
      summary.addedByMonth[month] = addedNow;
      summary.addedTotal += addedNow;
      summary.months.push({ month, added: addedNow });
      state = await saveState(state, statePath);
      logger.log?.(`${month}: ${addedNow}曲を追加`);
    } catch (err) {
      writeErrors.push({ month, message: String(err?.message ?? err) });
      summary.errors = writeErrors;
      // それまでに成功した分の state を保存してから再スロー
      try {
        await saveState(state, statePath);
      } catch {
        /* 保存失敗は元の例外を優先 */
      }
      throw err;
    }
  }

  // 回の処理が完了したら処理済みとして記録し、未マッチを積む
  for (const epId of Object.keys(remainingEpisodes)) {
    const matched = results.matched.filter((m) => m.track.episodeId === epId).length;
    const unmatched = results.unmatched.filter((u) => u.track.episodeId === epId).length;
    state = markEpisode(state, epId, { matched, unmatched });
  }
  state = recordUnmatched(state, results.unmatched.map((u) => ({
    episodeId: u.track.episodeId,
    airDate: u.track.airDate,
    title: u.track.title,
    artist: u.track.artist,
  })));
  state = await saveState(state, statePath);

  return { ok: true, cancelled: false, preview, summary };
}

function entriesFor(month, matched, uris) {
  const set = new Set(uris);
  return matched
    .filter((m) => set.has(m.candidate.uri))
    .map((m) => ({
      key: makeTrackKey(m.track.title, m.track.artist),
      uri: m.candidate.uri,
      month,
      episodeId: m.track.episodeId,
    }));
}

function buildPreview({ plan, matchedByMonth, state, minScore }) {
  const createdNames = [];
  const monthPlan = [];
  const lines = [];
  let totalAdds = 0;
  for (const month of plan.monthOrder) {
    const ms = matchedByMonth.get(month) ?? [];
    if (ms.length === 0) continue;
    const isNew = getPlaylist(state, month) == null;
    if (isNew) createdNames.push(playlistName(month));
    monthPlan.push({ month, tracks: ms.length, isNew });
    totalAdds += ms.length;
  }
  lines.push(`月別の追加予定: ${monthPlan.map((m) => `${m.month} ${m.tracks}曲`).join(" / ") || "(追加する曲はありません)"}`);
  if (createdNames.length > 0) lines.push(`新規作成するプレイリスト: ${createdNames.join(" / ")}`);
  lines.push(`合計 ${totalAdds}曲 (minScore=${minScore}・非公開で作成)`);
  return { createdNames, monthPlan, totalAdds, lines };
}
