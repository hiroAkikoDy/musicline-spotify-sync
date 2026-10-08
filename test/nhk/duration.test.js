import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseIsoDuration } from "../../src/nhk/duration.js";

describe("parseIsoDuration", () => {
  test("PT4M54S -> 294", () => {
    assert.equal(parseIsoDuration("PT4M54S"), 294);
  });
  test("正常系3種: PT1H2M3S / PT3M / PT45S", () => {
    assert.equal(parseIsoDuration("PT1H2M3S"), 3723);
    assert.equal(parseIsoDuration("PT3M"), 180);
    assert.equal(parseIsoDuration("PT45S"), 45);
  });
  test("PT0S -> 0", () => {
    assert.equal(parseIsoDuration("PT0S"), 0);
  });
  test("不正文字列 -> null", () => {
    assert.equal(parseIsoDuration("4分54秒"), null);
    assert.equal(parseIsoDuration("PT"), null);
    assert.equal(parseIsoDuration("PT4M54X"), null);
    assert.equal(parseIsoDuration("PT-4M"), null);
  });
  test("null / undefined / 空文字 -> null", () => {
    assert.equal(parseIsoDuration(null), null);
    assert.equal(parseIsoDuration(undefined), null);
    assert.equal(parseIsoDuration(""), null);
  });
});
