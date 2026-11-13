import { createHash } from "node:crypto";
import { hmacHex } from "@/server/auth/crypto";
import { callerOf } from "@/server/auth/service";
import type { Db } from "@/server/db";
import { loadScalevConfig, type ScalevConfig } from "./config";
import { sealPayload } from "./seal";
import { SIGNATURE_HEADER, verifySignature } from "./signature";
import { ORDER_ID_RE, TEST_EVENT, TRIGGER_EVENTS, WebhookEnvelope } from "./types";

/** Largest body accepted (SCALEV-AUTH-PLAN §4.1). Scalev order payloads are a few KB. */
export const MAX_BODY_BYTES = 256 * 1024;

const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } as const;
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });
const err = (status: number, code: string, message: string): Response => json(status, { error: { code, message } });

export interface IntakeDeps {
  /** Opened only after the signature is good, so an unsigned request never needs the database. */
  db: () => Promise<Db>;
  config?: ScalevConfig;
  /** Reads SESSION_PEPPER and TRUSTED_PROXY_HOPS for the keyed IP hash in reject logs. */
  env?: Record<string, string | undefined>;
  now?: () => Date;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

const defaultLog = (event: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ scope: "scalev", event, at: new Date().toISOString(), ...fields }));
};

/** Reads the body once, as bytes. Returns null as soon as it grows past the limit, without buffering the rest. */
async function readLimited(req: Request, max: number): Promise<Buffer | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/** Short strings only, so nothing like a name or an address can ride along into the minimal record. */
const short = (v: unknown, max = 64): string | null => {
  if ((typeof v === "string" || typeof v === "number") && String(v).length > 0 && String(v).length <= max)
    return String(v);
  return null;
};

/**
 * POST /api/v1/webhooks/scalev (SCALEV-AUTH-PLAN §4.1). Everything between "bytes arrive" and "200" lives here so tests
 * can drive it without Next. The order of the steps matters:
 *   1. refuse early (no secret, no payload key, body too big),
 *   2. check the signature over the raw bytes, before parsing anything,
 *   3. only then parse, encrypt, and write one row plus one job in one transaction.
 * No outbound network call happens here (PRD §19.8.6). The payload is a trigger, never proof.
 */
export async function handleScalevWebhook(req: Request, deps: IntakeDeps): Promise<Response> {
  const config = deps.config ?? loadScalevConfig(deps.env ?? process.env);
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? (() => new Date());
  const env = deps.env ?? process.env;

  const reject = (reason: string, bytes: number | null) => {
    let ipHash: string | undefined;
    const pepper = env.SESSION_PEPPER;
    if (pepper && pepper.length >= 32) {
      const hops = Number(env.TRUSTED_PROXY_HOPS ?? 1);
      ipHash = hmacHex(pepper, "ip", callerOf(req, Number.isInteger(hops) ? hops : 1).ip).slice(0, 16);
    }
    // Metadata only: never the body, never headers.
    log("webhook_rejected", { reason, bytes, ip_hash: ipHash });
  };

  // A dashboard "save" sends a test event and needs a clear failure when we are not ready, not a fake success.
  const secrets = [config.signingSecret, config.signingSecretPrevious].filter((s): s is string => !!s);
  if (!config.signingSecret) {
    return err(503, "NOT_AVAILABLE", "Webhook belum dikonfigurasi. Set SCALEV_WEBHOOK_SIGNING_SECRET.");
  }
  if (!config.payloadKey) {
    return err(503, "NOT_AVAILABLE", "Webhook belum dikonfigurasi. Set SCALEV_PAYLOAD_KEY (32 byte, base64).");
  }

  const raw = await readLimited(req, MAX_BODY_BYTES);
  if (!raw) {
    reject("too_large", null);
    return err(413, "VALIDATION_ERROR", "Body terlalu besar.");
  }

  if (!verifySignature(raw, req.headers.get(SIGNATURE_HEADER), secrets)) {
    reject("bad_signature", raw.length);
    return err(401, "UNAUTHENTICATED", "Tanda tangan tidak valid.");
  }

  // The signature is good, so a body that is not the expected shape is Scalev's problem, not an attacker's. Say so, write nothing.
  let envelope: WebhookEnvelope;
  try {
    const parsed = WebhookEnvelope.safeParse(JSON.parse(raw.toString("utf8")));
    if (!parsed.success) {
      log("webhook_malformed", { bytes: raw.length });
      return err(400, "VALIDATION_ERROR", "Format event tidak dikenali.");
    }
    envelope = parsed.data;
  } catch {
    log("webhook_malformed", { bytes: raw.length });
    return err(400, "VALIDATION_ERROR", "Body bukan JSON.");
  }

  // Scalev's endpoint check. Answered, not stored.
  if (envelope.event === TEST_EVENT) return json(200, { ok: true, test: true });

  const orderId =
    typeof envelope.data.id === "string" && ORDER_ID_RE.test(envelope.data.id) ? envelope.data.id.toLowerCase() : null;
  const trigger = TRIGGER_EVENTS.has(envelope.event) && orderId !== null;
  const note =
    TRIGGER_EVENTS.has(envelope.event) && orderId === null ? "missing_order_id" : trigger ? null : "not_a_trigger";
  // What may sit next to the encrypted payload in clear: event kind and order status. No customer, no address, no amount.
  const minimal: Record<string, string> = { event: envelope.event };
  const orderNumber = short(envelope.data.order_id);
  const paymentStatus = short(envelope.data.payment_status, 32);
  const status = short(envelope.data.status, 32);
  if (orderNumber) minimal.order_number = orderNumber;
  if (paymentStatus) minimal.payment_status = paymentStatus;
  if (status) minimal.status = status;

  const sealed = sealPayload(config.payloadKey, raw, `scalev:${envelope.unique_id}`);
  const sha = createHash("sha256").update(raw).digest("hex");

  try {
    const db = await deps.db();
    const rows = await db.asService((q) =>
      q.query<{ r: { duplicate: boolean } }>(
        "select app_private.scalev_ingest_event($1, $2, $3, $4::jsonb, $5::bytea, $6, $7, $8, $9::timestamptz) as r",
        [
          envelope.unique_id,
          envelope.event,
          orderId,
          JSON.stringify(minimal),
          sealed,
          sha,
          trigger,
          note,
          now().toISOString(),
        ],
      ),
    );
    const out = rows[0]?.r;
    log("webhook_accepted", { kind: envelope.event, duplicate: out?.duplicate === true, trigger });
    return json(200, out?.duplicate ? { ok: true, duplicate: true } : { ok: true });
  } catch (e) {
    // 503 makes Scalev send it again, and the sweeper covers the gap if it does not.
    log("webhook_store_failed", { reason: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
    return err(503, "NOT_AVAILABLE", "Belum bisa menyimpan event. Coba lagi.");
  }
}
