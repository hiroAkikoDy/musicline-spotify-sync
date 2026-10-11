// 週次自動実行（fetch → sync）の手順・ログ・ロック。テスト可能な形で集約したモジュール。
// - 二重起動防止: data/weekly.lock（6時間超の古いロックは無視して上書き・終了時に必ず削除）
// - 子プロセスで node src/index.js fetch / sync --yes --max-add 50 を実行
// - ログ: logs/weekly_YYYY-MM-DD_HHmmss.log（JST）+ 最新結果を logs/last_run.txt
// - 古いログ(60日)は実行の最後に整理
// すべての副作用（spawn・fs・時刻）は引数で注入できるため、ユニットテストは実プロセスを起動しない。
import { mkdir, readFile, writeFile, readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const STALE_LOCK_MS = 6 * 60 * 60 * 1000; // 6時間超のロックは古い扱い
const LOG_MAX_AGE_DAYS = 60;
const LOG_PREFIX = "weekly_";
const UTF8_BOM = "\uFEFF"; // last_run.txt / weekly_*.log を BOM 付き UTF-8 で書く(PowerShell 5.1 の type 対応)

// このファイル(script)や呼び出し元の import.meta.url からプロジェクトのルートを求める。
// package.json が見つかるまで親を辿る（scripts/ からも src/ops/ からも動く）。
export function resolveRoot(importMetaUrl) {
  let dir = dirname(fileURLToPath(importMetaUrl));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break; // ルートまで到達
    dir = parent;
  }
  return dir;
}

// JST のタイムスタンプ "YYYY-MM-DD_HHmmss"（ログファイル名用）
export function jstTimestamp(now = new Date()) {
  const j = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}-${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())}_${p(j.getUTCHours())}${p(j.getUTCMinutes())}${p(j.getUTCSeconds())}`;
}

// JST の可読日時 "YYYY-MM-DD HH:mm:ss"（last_run.txt・ログの表示用）
export function jstDateTime(now = new Date()) {
  const j = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}-${p(j.getUTCMonth() + 1)}-${p(j.getUTCDate())} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}:${p(j.getUTCSeconds())}`;
}

export function isLockStale(lock, now = new Date()) {
  const created = lock?.createdAt ? new Date(lock.createdAt) : null;
  if (!created || Number.isNaN(created.getTime())) return true;
  return now.getTime() - created.getTime() > STALE_LOCK_MS;
}

// ロックを取得する。新しいロックがあれば { acquired: false, holder } を返す（実行しない）。
export async function acquireLock(lockPath, { now = new Date(), pid = process.pid } = {}) {
  let existing = null;
  try {
    existing = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
  if (existing && !isLockStale(existing, now)) {
    return { acquired: false, holder: existing };
  }
  const content = { pid, createdAt: now.toISOString() };
  await mkdir(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, JSON.stringify(content), "utf8");
  return { acquired: true, holder: content };
}

export async function releaseLock(lockPath) {
  try {
    await rm(lockPath);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
}

// 失敗の種類に応じた案内文を返す。
export function pickFailureGuidance(message = "") {
  const m = String(message);
  if (/invalid_grant|refresh_token|再認証/i.test(m)) {
    return "Spotifyの認証が失効しています。`node scripts/auth_check.js` を実行して再認証してください。";
  }
  return "一時的なエラーの可能性があります。次回の実行で自動的に再試行されます（state は途中まで保存済み）。";
}

// 60日より古い weekly_*.log を削除する（last_run.txt は削除しない）。削除したファイル名を返す。
export async function cleanupOldLogs(logsDir, now = new Date(), { maxAgeDays = LOG_MAX_AGE_DAYS, prefix = LOG_PREFIX } = {}) {
  let names = [];
  try {
    names = await readdir(logsDir);
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  const deleted = [];
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(".log")) continue;
    const full = join(logsDir, name);
    const st = await stat(full).catch(() => null);
    if (st && st.mtimeMs < cutoff) {
      await rm(full);
      deleted.push(name);
    }
  }
  return deleted;
}

export function buildLastRunText({ ok, startedAtJst, finishedAtJst, added = 0, unmatched = 0, reason = null } = {}) {
  const lines = [
    `結果: ${ok ? "成功" : "失敗"}`,
    `開始: ${startedAtJst} (JST)`,
    `終了: ${finishedAtJst} (JST)`,
    `追加曲数: ${added}`,
    `未マッチ数: ${unmatched}`,
  ];
  if (reason) lines.push(`理由: ${reason}`);
  return `${lines.join("\n")}\n`;
}

const defaultSpawnImpl = (cmd, args, options) => spawnSync(cmd, args, options);

// 週次実行の本体。戻り値の code をスクリプト側で process.exitCode に使う。
// code: 0=成功 / 1=段階失敗 / 2=--max-add 超過 / 3=二重起動
export async function runWeekly({
  root,
  now = new Date(),
  nowFn = null,
  pid = process.pid,
  spawnImpl = defaultSpawnImpl,
  lockPath = join(root, "data", "weekly.lock"),
  logsDir = join(root, "logs"),
  maxAdd = 50,
  logger = console,
} = {}) {
  const indexJs = join(root, "src", "index.js");
  const startedAtJst = jstDateTime(now);
  const finishedAtJst = () => jstDateTime(nowFn ? nowFn() : new Date());

  // 二重起動防止
  const lock = await acquireLock(lockPath, { now, pid });
  if (!lock.acquired) {
    logger.warn?.(`すでに実行中の可能性があります（${lockPath}・開始: ${lock.holder?.createdAt}）。終了します。`);
    return { code: 3, ok: false, reason: "already_running" };
  }

  await mkdir(logsDir, { recursive: true });
  const logPath = join(logsDir, `${LOG_PREFIX}${jstTimestamp(now)}.log`);
  const logLines = [];
  // PowerShell 5.1 の type でも日本語が読めるよう UTF-8 BOM 付きで書く
  const flush = async () => writeFile(logPath, `${UTF8_BOM}${logLines.join("\n")}\n`, "utf8");
  const log = (line) => {
    logLines.push(line);
    logger.log?.(line);
  };

  let code = 0;
  let ok = true;
  let added = 0;
  let unmatched = 0;
  let reason = null;

  try {
    log(`=== ミュージックライン週次同期 開始 (${jstDateTime(now)} JST) ===`);
    const steps = [
      { name: "fetch", args: ["fetch"] },
      { name: "sync", args: ["sync", "--yes", "--max-add", String(maxAdd)] },
    ];
    for (const step of steps) {
      log(`=== ${step.name} ===`);
      const r = spawnImpl(process.execPath, [indexJs, ...step.args], { cwd: root, encoding: "utf8" });
      if (r.stdout) log(r.stdout.trimEnd());
      if (r.stderr) log(r.stderr.trimEnd());
      const message = `${r.stderr ?? ""}\n${r.stdout ?? ""}`;
      if (r.status !== 0) {
        ok = false;
        if (step.name === "sync" && r.status === 2) {
          code = 2;
          reason = `追加予定曲数が上限（${maxAdd}曲）を超えたため、1曲も書き込まずに中止しました。dry-run で内容を確認するか、手動で sync を実行してください。`;
        } else {
          code = 1;
          reason = pickFailureGuidance(message);
        }
        log(`[失敗] ${reason}`);
        break;
      }
      if (step.name === "sync") {
        added = Number(/追加曲数: (\d+)曲/.exec(r.stdout)?.[1] ?? 0);
        unmatched = Number(/未マッチ: (\d+)曲/.exec(r.stdout)?.[1] ?? 0);
      }
    }
    if (ok) log(`=== 完了: ${added}曲を追加・未マッチ ${unmatched}曲 ===`);

    // 最終結果とログの整理
    await writeFile(join(logsDir, "last_run.txt"), `${UTF8_BOM}${buildLastRunText({
      ok, startedAtJst, finishedAtJst: finishedAtJst(), added, unmatched, reason,
    })}`, "utf8");
    const deletedLogs = await cleanupOldLogs(logsDir, now);
    if (deletedLogs.length > 0) log(`古いログを削除しました: ${deletedLogs.join(", ")}`);
    await flush();
  } finally {
    await releaseLock(lockPath);
  }

  return { code, ok, added, unmatched, reason, logPath, logsDir };
}
