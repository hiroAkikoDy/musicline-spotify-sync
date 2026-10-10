// Spotify プレイリストAPIの薄いラッパ（2026-02 以降のエンドポイント）。
// - 作成: POST /me/playlists（旧 POST /users/{id}/playlists は Feb 2026 で削除）
// - 追加: POST /playlists/{id}/items（旧 /tracks → /items に改名。uris は1回最大100）
// - 取得: GET  /playlists/{id}/items（limit 最大50。items[].item.uri が新フィールド名）
// すべて spotifyFetch（(path, opts) => 解析済みJSON）を第1引数で受け取る。

const MAX_ADD_CHUNK = 100; // Add Items の uris 上限 (API仕様)
const LIST_PAGE_LIMIT = 50; // Get Playlist Items の limit 上限 (API仕様)

function addHeaders(opts) {
  return { "Content-Type": "application/json", ...(opts?.headers ?? {}) };
}

// プレイリストを作成する。既定は非公開 (public: false)。
export async function createPlaylist(spotifyFetch, { name, description = "", isPublic = false } = {}) {
  if (typeof name !== "string" || name === "") {
    throw new Error("createPlaylist: name は必須です");
  }
  const data = await spotifyFetch("/me/playlists", {
    method: "POST",
    headers: addHeaders(),
    body: { name, description, public: isPublic === true },
  });
  return { id: data?.id ?? "", name: data?.name ?? name, uri: data?.uri ?? "" };
}

// プレイリスト内の全アイテムの Spotify URI を返す（ページングを最後まで辿る）。
// items[].item.uri (新) / items[].track.uri (旧互換) を参照。ローカル曲など uri 無しは無視。
// 注意: このエンドポイントは自分がオーナー/共同編集者のプレイリストでのみ使える (403)。
export async function listPlaylistUris(spotifyFetch, playlistId, { pageLimit = LIST_PAGE_LIMIT } = {}) {
  const limit = Number.isInteger(pageLimit) && pageLimit > 0 ? Math.min(pageLimit, LIST_PAGE_LIMIT) : LIST_PAGE_LIMIT;
  const uris = [];
  let path = `/playlists/${encodeURIComponent(playlistId)}/items?limit=${limit}&offset=0`;
  for (;;) {
    const data = await spotifyFetch(path);
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const it of items) {
      const uri = it?.item?.uri ?? it?.track?.uri ?? null;
      if (typeof uri === "string" && uri !== "") uris.push(uri);
    }
    if (!data?.next || items.length === 0) break; // 最終ページ / 空ページで打ち切り
    path = data.next; // API が返す絶対URLをそのまま辿る
  }
  return uris;
}

// プレイリストへ URI を追加する（100件ずつ分割POST・入力内の重複は先勝ちで除去）。
// チャンク失敗時の例外には added（追加済み件数）を保持する。
export async function addTrackUris(spotifyFetch, playlistId, uris, { chunkSize = MAX_ADD_CHUNK } = {}) {
  const seen = new Set();
  const unique = (Array.isArray(uris) ? uris : []).filter((u) => {
    if (typeof u !== "string" || u === "" || seen.has(u)) return false;
    seen.add(u);
    return true;
  });
  const size = Number.isInteger(chunkSize) && chunkSize > 0 ? Math.min(chunkSize, MAX_ADD_CHUNK) : MAX_ADD_CHUNK;
  const chunks = [];
  for (let i = 0; i < unique.length; i += size) chunks.push(unique.slice(i, i + size));

  let added = 0;
  for (let i = 0; i < chunks.length; i++) {
    try {
      await spotifyFetch(`/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: "POST",
        headers: addHeaders(),
        body: { uris: chunks[i] },
      });
      added += chunks[i].length;
    } catch (err) {
      const e = new Error(`addTrackUris: ${i + 1}/${chunks.length}チャンク目で失敗しました (${added}件まで追加済み): ${err?.message ?? err}`);
      e.added = added;
      e.chunkIndex = i;
      e.totalChunks = chunks.length;
      e.cause = err;
      throw e;
    }
  }
  return { added, chunks: chunks.length };
}

// 既存プレイリストに登録済みの URI を除いた、追加すべき URI だけを返す（順序保持）。
export function ensureNotAlreadyAdded(existingUris, candidateUris) {
  const existing = new Set(Array.isArray(existingUris) ? existingUris : []);
  return (Array.isArray(candidateUris) ? candidateUris : []).filter((u) => typeof u === "string" && u !== "" && !existing.has(u));
}
