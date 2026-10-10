#!/usr/bin/env node
// 週次同期（fetch → sync --yes --max-add 50）の呼び出し口。
// 実行場所に依らず、このファイルの位置からプロジェクトのルートを求めて動く。
import { runWeekly, resolveRoot } from "../src/ops/weekly.js";

const root = resolveRoot(import.meta.url);
const result = await runWeekly({ root });
process.exitCode = result.code;
