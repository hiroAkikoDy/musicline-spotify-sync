// Spotify Web API 用の薄い共通fetchラッパ。
// - Bearer付与
// - 401 は1回だけ refresh して再試行
// - 429 は Retry-After 秒だけ待って再試行 (最大5回)
// - その他のエラーは本文を含めて例外
const API_BASE = "https://api.spotify.com/v1";
const MAX_429_RETRIES = 5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createSpotifyClient({ getToken, refreshToken, fetchImpl = fetch, sleepImpl = sleep } = {}) {
  if (!getToken) throw new Error("createSpotifyClient: getToken が必要です");
  return async function spotifyFetch(path, { method = "GET", headers = {}, body } = {}) {
    const url = /^https?:\/\//.test(path) ? path : `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
    let token = await getToken();
    let refreshed = false;
    let waited429 = 0;
    while (true) {
      const res = await fetchImpl(url, {
        method,
        headers: { ...headers, Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      if (res.ok) return res.json();
      if (res.status === 401 && !refreshed && refreshToken) {
        refreshed = true;
        token = await refreshToken();
        continue;
      }
      if (res.status === 429) {
        if (waited429 >= MAX_429_RETRIES) {
          throw new Error(`Spotify API error 429 (Retry-After を${MAX_429_RETRIES}回待機しても継続): ${url}`);
        }
        waited429++;
        const ra = Number(res.headers?.get?.("retry-after"));
        const waitSec = Number.isFinite(ra) && ra > 0 ? ra : 1;
        await sleepImpl(waitSec * 1000);
        continue;
      }
      const text = await res.text();
      throw new Error(`Spotify API error ${res.status} ${method} ${url}: ${text.slice(0, 300)}`);
    }
  };
}
