import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { generateCodeVerifier, codeChallengeS256, generateState } from "../../src/spotify/pkce.js";

const UNRESERVED_RE = /^[A-Za-z0-9\-._~]+$/;

describe("generateCodeVerifier", () => {
  test("デフォルト長は43〜128文字", () => {
    const v = generateCodeVerifier();
    assert.ok(v.length >= 43 && v.length <= 128, `length=${v.length}`);
  });
  test("指定長どおりに生成される (43 / 64 / 128)", () => {
    assert.equal(generateCodeVerifier(43).length, 43);
    assert.equal(generateCodeVerifier(64).length, 64);
    assert.equal(generateCodeVerifier(128).length, 128);
  });
  test("unreserved文字のみ (RFC 7636 §4.1)", () => {
    for (let i = 0; i < 20; i++) {
      assert.match(generateCodeVerifier(64), UNRESERVED_RE);
    }
  });
  test("呼び出しごとに異なる値", () => {
    assert.notEqual(generateCodeVerifier(), generateCodeVerifier());
  });
  test("43未満・128超・非整数はエラー", () => {
    assert.throws(() => generateCodeVerifier(42));
    assert.throws(() => generateCodeVerifier(129));
    assert.throws(() => generateCodeVerifier(0));
    assert.throws(() => generateCodeVerifier(64.5));
    assert.throws(() => generateCodeVerifier("64"));
  });
});

describe("codeChallengeS256", () => {
  test("RFC 7636 付録Bのテストベクトル", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    assert.equal(codeChallengeS256(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  test("base64url (パディングなし・+と/を含まない)", () => {
    const c = codeChallengeS256(generateCodeVerifier(64));
    assert.ok(!c.includes("="), "no padding");
    assert.ok(!c.includes("+"), "no +");
    assert.ok(!c.includes("/"), "no /");
    assert.match(c, /^[A-Za-z0-9\-_]+$/);
  });
  test("同一verifierなら同一challenge", () => {
    const v = "fixed-verifier-for-test-0123456789-abcdefghijkl";
    assert.equal(codeChallengeS256(v), codeChallengeS256(v));
  });
});

describe("generateState", () => {
  test("十分な長さのランダム文字列で、呼び出しごとに異なる", () => {
    const s1 = generateState();
    const s2 = generateState();
    assert.ok(s1.length >= 16, `length=${s1.length}`);
    assert.notEqual(s1, s2);
    assert.match(s1, /^[A-Za-z0-9\-._~]+$/);
  });
});
