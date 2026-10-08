// ISO8601 duration ("PT4M54S") を秒数に変換する。
const ISO_DURATION_RE = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

export function parseIsoDuration(value) {
  if (typeof value !== "string") return null;
  const m = ISO_DURATION_RE.exec(value.trim());
  if (!m) return null;
  if (m[1] === undefined && m[2] === undefined && m[3] === undefined) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  const s = m[3] ? Number(m[3]) : 0;
  return h * 3600 + min * 60 + s;
}
