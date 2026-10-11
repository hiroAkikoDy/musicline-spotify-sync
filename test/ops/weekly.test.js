import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  runWeekly,
  resolveRoot,
  jstTimestamp,
  jstDateTime,
  isLockStale,
  pickFailureGuidance,
  cleanupOldLogs,
  acquireLock,
  buildLastRunText,
} from "../../src/ops/weekly.js";

const NOW = new Date("2026-10-10T09:00:00+09:00"); // JST 土曜 9:00
const QUIET = { log: () => {}, warn: () => {} };

// spawn の記録と脚本。steps: [{ status, stdout, stderr }]
// 注意: runWeekly の spawnImpl は同期（spawnSync 相当）の契約なので、モックも同期関数にする。
function spawnScript(steps) {
  const calls = [];
  return {
    calls,
    spawnImpl: (cmd, args, options) => {
      const i = calls.length;
      calls.push({ cmd, args, options });
      const step = steps[i] ?? { status: 0, stdout: "", stderr: "" };
      return { status: step.status, stdout: step.stdout, stderr: step.stderr };
    },
  };
}

async function makeRoot() {
  const dir = await mkdtemp(join(tmpdir(), "weekly-test-"));
  await mkdir(join(dir, "data"), { recursive: true });
  await mkdir(join(dir, "src"), { recursive: true });
  return dir;
}

const FETCH_OK = { status: 0, stdout: "総数: 1663\n曲ありの回数: 23\n", stderr: "" };
const SYNC_OK = { status: 0, stdout: "追加曲数: 3曲 (2026-10: 3曲)\n未マッチ: 0曲 / エラー: 0曲\n", stderr: "" };

describe("runWeekly", () => {
  test("成功時: fetch→sync を実行し、ログと last_run.txt を書き、ロックを解除して 0 を返す", async () => {
    const root = await makeRoot();
    try {
      const { spawnImpl, calls } = spawnScript([FETCH_OK, SYNC_OK]);
      const r = await runWeekly({ root, now: NOW, spawnImpl });

      assert.equal(r.code, 0);
      assert.equal(r.ok, true);
      assert.deepEqual(calls.map((c) => c.args.slice(1)), [
        ["fetch"],
        ["sync", "--yes", "--max-add", "50"],
      ]);
      assert.ok(calls.every((c) => c.cmd === process.execPath));
      assert.ok(calls.every((c) => c.options.cwd === root));

      // ログ
      const files = await readdir(join(root, "logs"));
      assert.equal(files.filter((f) => f.startsWith("weekly_") && f.endsWith(".log")).length, 1);
      const logContent = await readFile(join(root, "logs", files.find((f) => f.startsWith("weekly_"))), "utf8");
      assert.match(logContent, /=== fetch ===/);
      assert.match(logContent, /=== sync ===/);
      assert.match(logContent, /総数: 1663/);

      // last_run.txt
      const last = await readFile(join(root, "logs", "last_run.txt"), "utf8");
      assert.match(last, /結果: 成功/);
      assert.match(last, /追加曲数: 3/);
      assert.match(last, /未マッチ数: 0/);
      assert.match(last, /2026-10-10/);

      // ロックは解除済み
      assert.deepEqual(await readdir(join(root, "data")), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fetch 失敗時: sync を実行せず終了コード1。last_run は失敗", async () => {
    const root = await makeRoot();
    try {
      const { spawnImpl, calls } = spawnScript([{ status: 1, stdout: "", stderr: "fetch error" }]);
      const r = await runWeekly({ root, now: NOW, spawnImpl });
      assert.equal(r.code, 1);
      assert.equal(r.ok, false);
      assert.equal(calls.length, 1); // sync は実行しない
      const last = await readFile(join(root, "logs", "last_run.txt"), "utf8");
      assert.match(last, /結果: 失敗/);
      assert.match(last, /次回の実行で自動的に再試行/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("sync の invalid_grant 失敗時: 再認証の案内を出す", async () => {
    const root = await makeRoot();
    try {
      const { spawnImpl } = spawnScript([
        FETCH_OK,
        { status: 1, stdout: "", stderr: "refresh_token が無効です (invalid_grant)。再認証してください。" },
      ]);
      const r = await runWeekly({ root, now: NOW, spawnImpl });
      assert.equal(r.code, 1);
      const last = await readFile(join(root, "logs", "last_run.txt"), "utf8");
      assert.match(last, /auth_check/);
      assert.match(last, /結果: 失敗/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("--max-add 超過(sync 終了コード2): 終了コード2で案内を出す", async () => {
    const root = await makeRoot();
    try {
      const { spawnImpl } = spawnScript([
        FETCH_OK,
        { status: 2, stdout: "追加予定 80曲 が上限 50曲 を超えたため、書き込みせずに中止しました。", stderr: "" },
      ]);
      const r = await runWeekly({ root, now: NOW, spawnImpl });
      assert.equal(r.code, 2);
      const last = await readFile(join(root, "logs", "last_run.txt"), "utf8");
      assert.match(last, /上限/);
      assert.match(last, /結果: 失敗/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("二重起動: 新しいロックがある場合は実行せず 3 を返す", async () => {
    const root = await makeRoot();
    try {
      const lockPath = join(root, "data", "weekly.lock");
      await writeFile(lockPath, JSON.stringify({ pid: 999, createdAt: NOW.toISOString() }), "utf8");
      const { spawnImpl, calls } = spawnScript([]);
      const r = await runWeekly({ root, now: NOW, spawnImpl });
      assert.equal(r.code, 3);
      assert.equal(calls.length, 0); // 何も実行しない
      // ロックは上書きされない
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      assert.equal(lock.pid, 999);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("古いロック(6時間超)は無視して実行する", async () => {
    const root = await makeRoot();
    try {
      const lockPath = join(root, "data", "weekly.lock");
      const old = new Date(NOW.getTime() - 6 * 3600 * 1000 - 60 * 1000);
      await writeFile(lockPath, JSON.stringify({ pid: 123, createdAt: old.toISOString() }), "utf8");
      const { spawnImpl } = spawnScript([FETCH_OK, SYNC_OK]);
      const r = await runWeekly({ root, now: NOW, spawnImpl });
      assert.equal(r.code, 0);
      assert.deepEqual(await readdir(join(root, "data")), []); // 終了時にロック削除
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("60日より古いログだけを整理する", async () => {
    const root = await makeRoot();
    try {
      const logsDir = join(root, "logs");
      await mkdir(logsDir, { recursive: true });
      const oldTime = new Date(NOW.getTime() - 61 * 86400 * 1000);
      const newTime = new Date(NOW.getTime() - 1 * 86400 * 1000);
      await writeFile(join(logsDir, "weekly_2026-08-01_090000.log"), "old", "utf8");
      await utimes(join(logsDir, "weekly_2026-08-01_090000.log"), oldTime, oldTime);
      await writeFile(join(logsDir, "weekly_2026-10-09_090000.log"), "new", "utf8");
      await utimes(join(logsDir, "weekly_2026-10-09_090000.log"), newTime, newTime);
      await writeFile(join(logsDir, "last_run.txt"), "x", "utf8");

      const { spawnImpl } = spawnScript([FETCH_OK, SYNC_OK]);
      await runWeekly({ root, now: NOW, spawnImpl });

      const files = (await readdir(logsDir)).sort();
      assert.deepEqual(files, ["last_run.txt"].concat(files.filter((f) => f.startsWith("weekly_"))).sort());
      assert.ok(files.includes("weekly_2026-10-09_090000.log"));
      assert.ok(!files.includes("weekly_2026-08-01_090000.log"));
      assert.ok(files.includes("last_run.txt"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("ユーティリティ", () => {
  test("resolveRoot: scripts/ から見ても src/ops/ から見てもルートを返す", async () => {
    // package.json を辿る実装のため、実ツリーを作って検証する
    const root = await mkdtemp(join(tmpdir(), "resolve-root-"));
    try {
      await mkdir(join(root, "scripts"), { recursive: true });
      await mkdir(join(root, "src", "ops"), { recursive: true });
      await writeFile(join(root, "package.json"), "{}", "utf8");
      await writeFile(join(root, "scripts", "weekly_sync.js"), "", "utf8");
      await writeFile(join(root, "src", "ops", "weekly.js"), "", "utf8");
      const toUrl = (p) => pathToFileURL(p).href;
      assert.equal(resolveRoot(toUrl(join(root, "scripts", "weekly_sync.js"))), root);
      assert.equal(resolveRoot(toUrl(join(root, "src", "ops", "weekly.js"))), root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("jstTimestamp: JST の YYYY-MM-DD_HHmmss を返す", () => {
    assert.equal(jstTimestamp(new Date("2026-10-10T00:00:00Z")), "2026-10-10_090000");
  });

  test("isLockStale: 6時間以内は false・超えたら true・壊れていても true", () => {
    const now = new Date("2026-10-10T09:00:00+09:00");
    assert.equal(isLockStale({ createdAt: new Date(now.getTime() - 5 * 3600 * 1000).toISOString() }, now), false);
    assert.equal(isLockStale({ createdAt: new Date(now.getTime() - 7 * 3600 * 1000).toISOString() }, now), true);
    assert.equal(isLockStale({ createdAt: "not-a-date" }, now), true);
    assert.equal(isLockStale({}, now), true);
  });

  test("pickFailureGuidance: 失敗の種類に応じた案内を返す", () => {
    assert.match(pickFailureGuidance("invalid_grant error"), /auth_check/);
    assert.match(pickFailureGuidance("refresh_token が無効"), /auth_check/);
    assert.match(pickFailureGuidance("ETIMEDOUT"), /次回の実行で自動的に再試行/);
    assert.match(pickFailureGuidance(" NHK fetch error "), /次回の実行で自動的に再試行/);
  });

  test("cleanupOldLogs: 対象外のファイル名は触らない", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cleanup-test-"));
    try {
      const old = new Date(NOW.getTime() - 100 * 86400 * 1000);
      await writeFile(join(dir, "weekly_old.log"), "x", "utf8");
      await utimes(join(dir, "weekly_old.log"), old, old);
      await writeFile(join(dir, "last_run.txt"), "x", "utf8");
      await utimes(join(dir, "last_run.txt"), old, old);
      const deleted = await cleanupOldLogs(dir, NOW);
      assert.deepEqual(deleted, ["weekly_old.log"]);
      assert.equal(await readFile(join(dir, "last_run.txt"), "utf8"), "x"); // last_run は削除しない
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("5B: jstDateTime / jstTimestamp", () => {
  test("jstDateTime: UTC→JST・HH:mm:ss 付き", () => {
    assert.equal(jstDateTime(new Date("2026-10-11T04:49:25Z")), "2026-10-11 13:49:25");
  });
  test("jstDateTime: 日付をまたぐ場合(UTC 15:30 → JST 翌日 00:30)", () => {
    assert.equal(jstDateTime(new Date("2026-10-10T15:30:00Z")), "2026-10-11 00:30:00");
  });
  test("jstTimestamp は従来どおり YYYY-MM-DD_HHmmss(回帰・ファイル名用)", () => {
    assert.equal(jstTimestamp(new Date("2026-10-11T04:49:25Z")), "2026-10-11_134925");
  });
});

describe("5B: buildLastRunText (開始・終了の両方)", () => {
  test("成功時: 結果・開始・終了・追加曲数・未マッチ数を書く", () => {
    const text = buildLastRunText({
      ok: true,
      startedAtJst: "2026-10-11 13:49:25",
      finishedAtJst: "2026-10-11 13:49:41",
      added: 0,
      unmatched: 0,
    });
    assert.match(text, /結果: 成功/);
    assert.match(text, /開始: 2026-10-11 13:49:25 \(JST\)/);
    assert.match(text, /終了: 2026-10-11 13:49:41 \(JST\)/);
    assert.match(text, /追加曲数: 0/);
    assert.match(text, /未マッチ数: 0/);
    assert.doesNotMatch(text, /日時:/); // 旧形式(日時: 1行)は廃止
  });
  test("失敗時: 理由も書く", () => {
    const text = buildLastRunText({
      ok: false,
      startedAtJst: "2026-10-11 13:49:25",
      finishedAtJst: "2026-10-11 13:49:41",
      added: 0,
      unmatched: 0,
      reason: "一時的なエラーの可能性があります",
    });
    assert.match(text, /結果: 失敗/);
    assert.match(text, /理由: 一時的なエラーの可能性があります/);
  });
});

describe("5B: last_run.txt と weekly_*.log の BOM", () => {
  test("先頭3バイトが EF BB BF (UTF-8 BOM)", async () => {
    const root = await makeRoot();
    try {
      const { spawnImpl } = spawnScript([FETCH_OK, SYNC_OK]);
      const end = new Date("2026-10-11T04:49:41Z");
      await runWeekly({ root, now: NOW, nowFn: () => end, spawnImpl, logger: QUIET });
      const logsDir = join(root, "logs");
      const files = (await readdir(logsDir)).filter((f) => f.startsWith("weekly_") && f.endsWith(".log"));
      assert.equal(files.length, 1);
      const logBytes = await readFile(join(logsDir, files[0]));
      assert.deepEqual([...logBytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
      const lastBytes = await readFile(join(logsDir, "last_run.txt"));
      assert.deepEqual([...lastBytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("last_run.txt の内容に 開始/終了 が入り、nowFn で終了時刻を注入できる", async () => {
    const root = await makeRoot();
    try {
      const { spawnImpl } = spawnScript([FETCH_OK, SYNC_OK]);
      const end = new Date("2026-10-11T04:49:41Z");
      await runWeekly({ root, now: NOW, nowFn: () => end, spawnImpl, logger: QUIET });
      const last = await readFile(join(root, "logs", "last_run.txt"), "utf8");
      assert.match(last, /開始: 2026-10-10 09:00:00 \(JST\)/); // NOW = 2026-10-10T00:00Z → JST 10-10 09:00
      assert.match(last, /終了: 2026-10-11 13:49:41 \(JST\)/); // end = 04:49Z → JST 13:49
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

