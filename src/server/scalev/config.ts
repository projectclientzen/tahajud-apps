import { Buffer } from "node:buffer";

/** What the Scalev integration reads from the environment. Nothing here has a default that reaches a real Scalev account. */
export interface ScalevConfig {
  /** Base URL of the Scalev API, no trailing slash. */
  apiBase: string;
  /** Restricted API key (order:read, order:list). Null = the worker cannot verify orders and says so. */
  apiKey: string | null;
  storeId: string | null;
  /** Webhook signing secret from the Scalev dashboard. Null = the webhook route answers 503. */
  signingSecret: string | null;
  /** Old secret that stays valid while the new one is rolled out. */
  signingSecretPrevious: string | null;
  /** 32 byte AES-256-GCM key for stored webhook payloads. Null = the webhook route answers 503 (nothing is stored in clear). */
  payloadKey: Buffer | null;
  payloadKeyProblem?: string;
  /** Variants that grant access. Numeric ids and SKUs, both accepted. Empty = every order goes to quarantine. */
  allowedVariants: AllowedVariants;
  /** Orders below this net amount (IDR) are quarantined. Null = no minimum (PROVISIONAL, Q4). */
  minAmountIdr: number | null;
  /** Poll Scalev for paid orders that never sent a webhook. */
  sweepEnabled: boolean;
}

export interface AllowedVariants {
  /** Numeric Scalev variant ids, as strings ("12345"). */
  ids: ReadonlySet<string>;
  /** SKUs, compared case-insensitively. */
  skus: ReadonlySet<string>;
}

export const DEFAULT_SCALEV_API_BASE = "https://api.scalev.com";

/**
 * SCALEV_ALLOWED_VARIANT_IDS is a comma separated list. An entry made only of digits is a numeric variant id
 * (orderlines[].variant). Anything else is a SKU (orderlines[].variant_sku). Both kinds can be mixed.
 */
export function parseAllowedVariants(raw: string | undefined): AllowedVariants {
  const ids = new Set<string>();
  const skus = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const v = part.trim();
    if (!v) continue;
    if (/^\d+$/.test(v)) ids.add(String(Number(v)));
    else skus.add(v.toLowerCase());
  }
  return { ids, skus };
}

function parsePayloadKey(raw: string | undefined): { key: Buffer | null; problem?: string } {
  const v = raw?.trim();
  if (!v) return { key: null, problem: "SCALEV_PAYLOAD_KEY is not set. Use 32 random bytes, base64 encoded." };
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) return { key: null, problem: "SCALEV_PAYLOAD_KEY is not base64." };
  const key = Buffer.from(v, "base64");
  if (key.length !== 32) return { key: null, problem: "SCALEV_PAYLOAD_KEY must decode to exactly 32 bytes." };
  return { key };
}

function parseApiBase(raw: string | undefined, env: Record<string, string | undefined>): string {
  const v = raw?.trim().replace(/\/+$/, "");
  if (!v) return DEFAULT_SCALEV_API_BASE;
  const isTest = env.NODE_ENV !== "production" || env.TAHAJUD_ALLOW_TEST_DB === "true";
  // A fake Scalev server on localhost is allowed outside production. A real deployment talks https only.
  if (!/^https:\/\//i.test(v) && !(isTest && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(v))) {
    throw new Error("SCALEV_API_BASE must be an https URL.");
  }
  return v;
}

export function loadScalevConfig(env: Record<string, string | undefined> = process.env): ScalevConfig {
  const key = parsePayloadKey(env.SCALEV_PAYLOAD_KEY);
  const min = env.SCALEV_MIN_AMOUNT_IDR?.trim();
  const minAmount = min && /^\d+$/.test(min) ? Number(min) : null;
  const sweep = env.SCALEV_SWEEP_ENABLED?.trim().toLowerCase();
  return {
    apiBase: parseApiBase(env.SCALEV_API_BASE, env),
    apiKey: env.SCALEV_API_KEY?.trim() || null,
    storeId: env.SCALEV_STORE_ID?.trim() || null,
    signingSecret: env.SCALEV_WEBHOOK_SIGNING_SECRET?.trim() || null,
    signingSecretPrevious: env.SCALEV_WEBHOOK_SIGNING_SECRET_PREVIOUS?.trim() || null,
    payloadKey: key.key,
    payloadKeyProblem: key.problem,
    allowedVariants: parseAllowedVariants(env.SCALEV_ALLOWED_VARIANT_IDS),
    minAmountIdr: minAmount,
    sweepEnabled: sweep !== "false" && sweep !== "0",
  };
}
