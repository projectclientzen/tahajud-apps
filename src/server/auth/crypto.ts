import { createHmac, randomBytes } from "node:crypto";
import { normalizePhone } from "@/domain/auth/phone";

/** Keyed hash with a scope, so a value hashed for one purpose can never match another. Output is hex. */
export const hmacHex = (pepper: string, scope: string, value: string): string =>
  createHmac("sha256", pepper).update(`${scope}:${value}`).digest("hex");

/** 256 random bits, URL safe. Cookie secrets, pending-login tokens and admin reset tokens. */
export const newSecret = (): string => randomBytes(32).toString("base64url");

/**
 * Keyed hash of a phone number after normalization, or null when the input is not a phone number.
 * This is THE function that turns a phone into what the database stores and matches
 * (`purchase_orders.customer_phone_hash`). The Scalev worker must call exactly this, with the same pepper.
 */
export function hashPhone(pepper: string, rawPhone: string): string | null {
  const n = normalizePhone(rawPhone);
  return n ? hmacHex(pepper, "phone", n) : null;
}
