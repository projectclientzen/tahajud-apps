import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadScalevConfig, type ScalevConfig } from "@/server/scalev/config";
import { signBody } from "@/server/scalev/signature";

export const FIXTURE_DIR = join(__dirname, "..", "..", "fixtures", "scalev");

/** Every fixture says it is not a real Scalev sample. The marker is checked here and stripped before use. */
export function fixture<T = Record<string, unknown>>(name: string): T {
  const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as Record<string, unknown>;
  const mark = raw._fixture as { status?: string } | undefined;
  if (mark?.status !== "NEEDS_VERIFICATION") throw new Error(`${name} is missing the NEEDS_VERIFICATION marker`);
  delete raw._fixture;
  return raw as T;
}

export const SECRET = "whsec_test_" + "a".repeat(32);
export const OLD_SECRET = "whsec_old_" + "b".repeat(32);
export const PAYLOAD_KEY = randomBytes(32).toString("base64");
export const ORDER_ID = "0192f3a0-7b1c-7d2e-8a41-5c6d7e8f9a01";

/** Environment for a configured Scalev. Variants: the numeric id and the SKU of the demo product. */
export function scalevEnv(over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: "test",
    SCALEV_WEBHOOK_SIGNING_SECRET: SECRET,
    SCALEV_PAYLOAD_KEY: PAYLOAD_KEY,
    SCALEV_API_KEY: "sk_test_fake_key_not_real",
    SCALEV_STORE_ID: "2785",
    SCALEV_ALLOWED_VARIANT_IDS: "5550001",
    SESSION_PEPPER: "test-pepper-test-pepper-test-pepper-0123456789",
    TRUSTED_PROXY_HOPS: "1",
    ...over,
  };
}

export const scalevConfig = (over: Record<string, string | undefined> = {}): ScalevConfig =>
  loadScalevConfig(scalevEnv(over));

export function signedRequest(
  body: unknown,
  opts: { secret?: string; headers?: Record<string, string>; raw?: string } = {},
): Request {
  const text = opts.raw ?? (typeof body === "string" ? body : JSON.stringify(body));
  return new Request("http://localhost:3100/api/v1/webhooks/scalev", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-scalev-hmac-sha256": signBody(text, opts.secret ?? SECRET),
      ...opts.headers,
    },
    body: text,
  });
}

export function envelope(
  event: string,
  uniqueId: string,
  data: Record<string, unknown> = { id: ORDER_ID },
): Record<string, unknown> {
  return { event, unique_id: uniqueId, timestamp: "2026-11-13T08:15:42.000000Z", data };
}
