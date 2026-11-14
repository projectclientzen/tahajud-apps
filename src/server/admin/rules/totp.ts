import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** RFC 6238 time based one time passwords (SHA-1, 6 digits, 30 second step), as every authenticator app expects. */
export const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = (): Buffer => randomBytes(20);

export const stepOf = (nowMs: number): number => Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

/** HOTP (RFC 4226) for one counter value. */
export function hotp(secret: Uint8Array, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const totp = (secret: Uint8Array, nowMs: number): string => hotp(secret, stepOf(nowMs));

const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Accepts the current step and one step either side (clock drift). Returns the step that matched, so the caller can
 * refuse that step, and every step before it, from then on (replay guard).
 */
export function verifyTotp(secret: Uint8Array, code: string, nowMs: number, lastUsedStep: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepOf(nowMs);
  let hit: number | null = null;
  // Check all three on purpose, so timing does not say which one matched.
  for (const step of [now - 1, now, now + 1]) {
    if (same(hotp(secret, step), code) && step > lastUsedStep) hit = step;
  }
  return hit;
}

export function otpauthUri(opts: { issuer: string; account: string; secret: Uint8Array }): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.account}`);
  const q = new URLSearchParams({
    secret: base32Encode(opts.secret),
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

// ---- the secret at rest: AES-256-GCM, key derived from MFA_ENC_KEY (cfg.mfaKey) ----
const keyFor = (key: string): Buffer => createHmac("sha256", key).update("admin-mfa-secret-key-v1").digest();

export function sealSecret(pepper: string, secret: Uint8Array): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFor(pepper), iv);
  const ct = Buffer.concat([c.update(secret), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function openSecret(pepper: string, sealed: string): Buffer {
  const raw = Buffer.from(sealed, "base64");
  const d = createDecipheriv("aes-256-gcm", keyFor(pepper), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
}
