// PKCE (RFC 7636) の code verifier / code challenge / state 生成。
import { createHash, randomBytes } from "node:crypto";

const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

// 43〜128文字の code verifier を unreserved 文字のみで生成する。
export function generateCodeVerifier(length = 96) {
  if (!Number.isInteger(length) || length < 43 || length > 128) {
    throw new Error(`code verifier の長さは43〜128の整数である必要があります (RFC 7636 §4.1): 指定値=${length}`);
  }
  let out = "";
  while (out.length < length) {
    const buf = randomBytes(length);
    for (const b of buf) {
      if (out.length >= length) break;
      // モジュロバイアス除去: 66文字 × 3 = 198 未満のバイト値のみ採用
      if (b < 198) out += UNRESERVED[b % UNRESERVED.length];
    }
  }
  return out;
}

// SHA256 → base64url (パディングなし)。RFC 7636 §4.2 の S256。
export function codeChallengeS256(verifier) {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

// CSRF対策の state を生成する。
export function generateState() {
  return randomBytes(24).toString("base64url");
}
