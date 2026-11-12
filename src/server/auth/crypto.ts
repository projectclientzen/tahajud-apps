import { createHmac, randomBytes, randomInt } from "node:crypto";

/** Keyed hash with a scope, so a value hashed for one purpose can never match another. Output is hex. */
export const hmacHex = (pepper: string, scope: string, value: string): string =>
  createHmac("sha256", pepper).update(`${scope}:${value}`).digest("hex");

/** 256 random bits, URL safe. Cookie secrets and pending-login tokens. */
export const newSecret = (): string => randomBytes(32).toString("base64url");

/** Six digits from a cryptographic source. */
export const newOtp = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");
