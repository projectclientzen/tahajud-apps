import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for webhook payloads kept at rest (PRD SEC-07). Layout of the stored bytes:
 *   1 byte version (1) | 12 byte nonce | 16 byte tag | ciphertext
 * `aad` ties the ciphertext to its event id, so a payload copied onto another row fails to open.
 * The key comes from SCALEV_PAYLOAD_KEY and is never stored. Losing the key makes old payloads unreadable (by design).
 */
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function sealPayload(key: Uint8Array, plaintext: Uint8Array, aad: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
}

/** Throws when the key, the aad or the bytes are wrong. */
export function openPayload(key: Uint8Array, sealed: Uint8Array, aad: string): Buffer {
  const b = Buffer.from(sealed);
  if (b.length < 1 + IV_BYTES + TAG_BYTES || b[0] !== VERSION) throw new Error("Unknown sealed payload format");
  const iv = b.subarray(1, 1 + IV_BYTES);
  const tag = b.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(b.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]);
}
