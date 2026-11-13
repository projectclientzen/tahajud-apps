import { createHash } from "node:crypto";
import { one } from "@/server/db";
import type { Services } from "@/server/jobs/services";
import { JobError } from "@/server/jobs/types";
import { ScalevApiError, type ScalevOrder } from "./client";
import { sealPayload } from "./seal";
import { hasAllowedVariant, allowlistIsEmpty } from "./variant-resolver";

/** Orders listed per Scalev call, and how many pages one sweep reads per payment status. 200 orders at most. */
const PAGE_SIZE = 25;
const MAX_PAGES = 8;

export interface SweepResult {
  heal: { given_up: number; requeued: number };
  polling: "done" | "disabled" | "not_configured" | "NEEDS_VERIFICATION";
  reason?: string;
  listed: number;
  skippedOtherProduct: number;
  alreadyKnown: number;
  enqueued: number;
}

/**
 * The safety net for events that never arrive or never finish (SCALEV-AUTH-PLAN §4.6):
 *   1. self-heal (database only, always): events waiting with no job get one; events older than 3 days are given up.
 *   2. polling (needs SCALEV_API_KEY, SCALEV_STORE_ID, SCALEV_PAYLOAD_KEY, SCALEV_SWEEP_ENABLED not "false"): lists paid and
 *      settled orders of the store, newest first, and files a synthetic event for each one that has no verified order
 *      row yet. The synthetic event goes through the same path as a webhook, so it still ends in a GET before any access.
 * NEEDS_VERIFICATION: the list endpoint and its response shape are from the docs only. An unreadable response ends the
 * poll quietly ("NEEDS_VERIFICATION") instead of failing every 10 minutes; set SCALEV_SWEEP_ENABLED=false to stop polling.
 */
export async function sweepOrders(svc: Services, opts: { windowHours: number }): Promise<SweepResult> {
  const now = svc.now();
  const rt = svc.scalev;
  const heal = await svc.db.asService((q) =>
    one<{ given_up: number; requeued: number }>(q, "app_private.scalev_self_heal($1::timestamptz)", [
      now.toISOString(),
    ]),
  );
  const out: SweepResult = { heal, polling: "done", listed: 0, skippedOtherProduct: 0, alreadyKnown: 0, enqueued: 0 };

  if (!rt.config.sweepEnabled) return { ...out, polling: "disabled" };
  if (!rt.client || !rt.config.storeId || !rt.config.payloadKey) {
    return {
      ...out,
      polling: "not_configured",
      reason: rt.problem ?? "SCALEV_STORE_ID or SCALEV_PAYLOAD_KEY is not set.",
    };
  }
  if (allowlistIsEmpty(rt.config.allowedVariants)) {
    return {
      ...out,
      polling: "not_configured",
      reason: "SCALEV_ALLOWED_VARIANT_IDS is empty, so no listed order could grant access.",
    };
  }

  const since = now.getTime() - opts.windowHours * 3600_000;
  try {
    for (const paymentStatus of ["paid", "settled"] as const) {
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await rt.client.listOrders({
          storeId: rt.config.storeId,
          paymentStatus,
          cursor,
          pageSize: PAGE_SIZE,
        });
        out.listed += res.orders.length;
        const inWindow = res.orders.filter(
          (o) => !o.createdAt || Date.parse(o.createdAt) >= since || Number.isNaN(Date.parse(o.createdAt)),
        );
        const candidates = inWindow.filter((o) => {
          // The list shows orders of every product in the store. One whose lines are all for other products is not ours.
          if (o.orderlines.length > 0 && !hasAllowedVariant(o.orderlines, rt.config.allowedVariants)) {
            out.skippedOtherProduct += 1;
            return false;
          }
          return true;
        });
        const known = await knownOrders(
          svc,
          candidates.map((o) => o.id),
        );
        for (const o of candidates) {
          if (known.has(o.id)) {
            out.alreadyKnown += 1;
            continue;
          }
          if (await enqueueSynthetic(svc, o, paymentStatus, now)) out.enqueued += 1;
        }
        // Newest first: once a page reaches back beyond the window there is nothing more to find.
        if (inWindow.length < res.orders.length || !res.nextCursor) break;
        cursor = res.nextCursor;
      }
    }
  } catch (e) {
    if (!(e instanceof ScalevApiError)) throw e;
    if (e.kind === "bad_response") return { ...out, polling: "NEEDS_VERIFICATION", reason: e.message };
    // 401 and 403 are not retried (SCALEV-12). Anything else is tried again later.
    throw new JobError(`Scalev sweep: ${e.message}`, e.retryable, e.retryAfterSeconds ?? undefined);
  }
  return out;
}

async function knownOrders(svc: Services, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await svc.db.asService((q) =>
    q.query<{ scalev_order_id: string }>(
      "select scalev_order_id from public.purchase_orders where scalev_order_id = any($1::text[]) and verified_via is not null",
      [ids],
    ),
  );
  return new Set(rows.map((r) => r.scalev_order_id));
}

/** One synthetic event per order and payment status. The same order is filed once, however often the sweep runs. */
async function enqueueSynthetic(
  svc: Services,
  order: ScalevOrder,
  paymentStatus: "paid" | "settled",
  now: Date,
): Promise<boolean> {
  const key = svc.scalev.config.payloadKey!;
  const eventId = `poll:${order.id}:${paymentStatus}`;
  const body = Buffer.from(
    JSON.stringify({ synthetic: true, source: "sweep", order_id: order.id, payment_status: paymentStatus }),
  );
  const minimal = {
    event: "payment.received",
    payment_status: paymentStatus,
    source: "sweep",
    ...(order.orderNumber ? { order_number: order.orderNumber } : {}),
  };
  const r = await svc.db.asService((q) =>
    one<{ duplicate: boolean }>(
      q,
      "app_private.scalev_ingest_event($1, 'payment.received', $2, $3::jsonb, $4::bytea, $5, true, 'sweep', $6::timestamptz)",
      [
        eventId,
        order.id,
        JSON.stringify(minimal),
        sealPayload(key, body, `scalev:${eventId}`),
        createHash("sha256").update(body).digest("hex"),
        now.toISOString(),
      ],
    ),
  );
  return !r.duplicate;
}
