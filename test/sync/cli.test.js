import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const indexJs = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "index.js");

function runCli(args, cwd) {
  return run(process.execPath, [indexJs, ...args], { cwd, encoding: "utf8" });
}

describe("CLI: sync サブコマンド", () => {
  test("--dry-run なしで実行されたらエラー終了(書き込み未実装)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sync-cli-no-dryrun-"));
    try {
      await assert.rejects(
        () => runCli(["sync"], dir),
        (err) => {
          assert.equal(err.code, 1);
          assert.match(err.stderr, /未実装/);
          assert.match(err.stderr, /--dry-run/);
          return true;
        }
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("episodes.json が無ければ fetch 実行を案内して終了する", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sync-cli-no-cache-"));
    try {
      await assert.rejects(
        () => runCli(["sync", "--dry-run", "--limit", "5"], dir),
        (err) => {
          assert.equal(err.code, 1);
          assert.match(err.stderr, /episodes\.json/);
          assert.match(err.stderr, /fetch/);
          return true;
        }
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("--since の形式が不正ならエラー終了", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sync-cli-bad-since-"));
    try {
      await assert.rejects(
        () => runCli(["sync", "--dry-run", "--since", "2026/10/01"], dir),
        (err) => {
          assert.equal(err.code, 1);
          assert.match(err.stderr, /--since/);
          return true;
        }
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
