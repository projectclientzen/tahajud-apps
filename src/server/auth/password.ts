import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { normalizePassword } from "@/domain/auth/password-policy";

/**
 * Password hashing with scrypt from node:crypto. No native dependency.
 *
 * Starting parameters N=2^15, r=8, p=3 (32 MiB per hash) are one of the equivalent settings listed in the OWASP
 * Password Storage Cheat Sheet for scrypt (checked 13 Nov 2026). Node's scrypt needs `maxmem` above 128*N*r bytes
 * (32 MiB for these numbers), and its default limit is exactly 32 MiB, so `maxmem` is set to 64 MiB here.
 * Re-measure on the real VPS before launch and raise the numbers if a hash takes well under 100 ms there.
 *
 * Stored as a PHC style string: `$scrypt$ln=15,r=8,p=3$<salt b64>$<hash b64>`. The parameters travel with the hash,
 * so they can be raised later and old hashes still verify (and are replaced after the next correct login).
 */
export interface ScryptParams {
  /** log2 of N. */
  ln: number;
  r: number;
  p: number;
}

export const DEFAULT_SCRYPT: ScryptParams = { ln: 15, r: 8, p: 3 };

const KEY_LEN = 32;
const SALT_LEN = 16;
const MAXMEM = 64 * 1024 * 1024;
/** A stored string asks for at most this much work, whatever it says. Stops a bad row from becoming a memory bomb. */
const MAX_LN = 17;

const derive = (password: string, salt: Buffer, p: ScryptParams, keyLen: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(
      normalizePassword(password),
      salt,
      keyLen,
      { N: 2 ** p.ln, r: p.r, p: p.p, maxmem: MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });

const b64 = (b: Buffer): string => b.toString("base64").replace(/=+$/, "");

export async function hashPassword(password: string, params: ScryptParams = DEFAULT_SCRYPT): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await derive(password, salt, params, KEY_LEN);
  return `$scrypt$ln=${params.ln},r=${params.r},p=${params.p}$${b64(salt)}$${b64(key)}`;
}

interface Parsed {
  params: ScryptParams;
  salt: Buffer;
  key: Buffer;
}

function parse(stored: string): Parsed | null {
  const m = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(stored);
  if (!m) return null;
  const params = { ln: Number(m[1]), r: Number(m[2]), p: Number(m[3]) };
  if (params.ln < 10 || params.ln > MAX_LN || params.r < 1 || params.r > 16 || params.p < 1 || params.p > 8) return null;
  const salt = Buffer.from(m[4]!, "base64");
  const key = Buffer.from(m[5]!, "base64");
  if (salt.length < 8 || key.length < 16) return null;
  return { params, salt, key };
}

/** True when the password matches. A malformed hash is simply false. Compares in constant time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  const key = await derive(password, parsed.salt, parsed.params, parsed.key.length);
  return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
}

/** True when the stored hash was made with weaker settings than the current ones. */
export function needsRehash(stored: string, current: ScryptParams): boolean {
  const parsed = parse(stored);
  if (!parsed) return true;
  const { ln, r, p } = parsed.params;
  return ln < current.ln || r < current.r || p < current.p;
}

/**
 * A hash nobody can match, made with the current settings. Login runs a check against it when the email has no
 * account, so "no such account" and "wrong password" take the same time.
 */
const dummyCache = new Map<string, Promise<string>>();
export function dummyHash(params: ScryptParams): Promise<string> {
  const key = `${params.ln}.${params.r}.${params.p}`;
  let h = dummyCache.get(key);
  if (!h) {
    h = hashPassword(randomBytes(24).toString("base64"), params);
    dummyCache.set(key, h);
  }
  return h;
}
