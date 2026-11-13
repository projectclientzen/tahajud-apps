import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-scalev-hmac-sha256";

/** A SHA-256 digest is 32 bytes: 44 Base64 characters with one "=" of padding. */
const BASE64_SHA256 = /^[A-Za-z0-9+/]{43}=$/;

/**
 * Checks `X-Scalev-Hmac-Sha256`: Base64 of HMAC-SHA256 over the raw request body (not over parsed JSON).
 * Compares the decoded bytes in constant time. Tries every secret given (the current one and, during a rotation,
 * the previous one) and does not stop at the first match, so the time does not say which one was right.
 */
export function verifySignature(rawBody: Uint8Array, header: string | null, secrets: readonly string[]): boolean {
  const given = header?.trim();
  if (!given || !BASE64_SHA256.test(given)) return false;
  const got = Buffer.from(given, "base64");
  if (got.length !== 32) return false;
  let ok = false;
  for (const secret of secrets) {
    if (!secret) continue;
    const want = createHmac("sha256", secret).update(rawBody).digest();
    if (timingSafeEqual(got, want)) ok = true;
  }
  return ok;
}

/** What the sender computes. Used by tests and by fixtures; the server only verifies. */
export function signBody(rawBody: Uint8Array | string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}
