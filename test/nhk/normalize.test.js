import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { normalizeText, makeTrackKey } from "../../src/nhk/normalize.js";

describe("normalizeText", () => {
  test("全角英数 -> 半角", () => {
    assert.equal(normalizeText("ｔｏｍａｔｏ"), "tomato");
    assert.equal(normalizeText("ＮＥＷ　ＹＯＲＫ"), "NEW YORK");
  });
  test("前後trimと連続空白を1つに", () => {
    assert.equal(normalizeText("  a   b　c  "), "a b c");
    assert.equal(normalizeText("\t x \n y \t"), "x y");
  });
  test("全角スペースも半角スペースに", () => {
    assert.equal(normalizeText("Ａ　Ｂ"), "A B");
  });
  test("非文字列 -> 空文字", () => {
    assert.equal(normalizeText(null), "");
    assert.equal(normalizeText(undefined), "");
    assert.equal(normalizeText(123), "");
    assert.equal(normalizeText({ a: 1 }), "");
  });
});

describe("makeTrackKey", () => {
  test("正規化後・小文字化した title|artist", () => {
    assert.equal(makeTrackKey("ｔｏｍａｔｏ", "ＹＡＭＡＤＡ　Ｔａｒｏ"), "tomato|yamada taro");
  });
  test("大文字小文字・空白のゆらぎを吸収", () => {
    assert.equal(makeTrackKey("Tomato  Juice", "TARO"), makeTrackKey("tomato juice", "taro"));
  });
  test("非文字列でも動く", () => {
    assert.equal(makeTrackKey(null, undefined), "|");
  });
});
