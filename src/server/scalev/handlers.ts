import { UUID_RE, type Db } from "@/server/db";
import { queue } from "@/server/jobs/queue";
import type { Services } from "@/server/jobs/services";
import { JOB_TYPES, JobError, type JobHandlers, type JobRow } from "@/server/jobs/types";
import { ScalevApiError, type ScalevOrder } from "./client";
import { purgePayloads } from "./purge";
import { applyOrder, flagOrder, orderState } from "./provision";
import { sweepOrders } from "./sweep";
import { PAID_STATUSES, evaluateOrder } from "./verify";

/** A payment that is not visible in the API yet is checked again after 1, 5, 15, 60 minutes, then every 6 hours (PRD §20.3). */
export function awaitingDelaySeconds(attempt: number): number {
  const steps = [60, 300, 900, 3600];
  return attempt >= 1 && attempt <= steps.length ? steps[attempt - 1]! : 6 * 3600;
}

/** How long an event may stay unverified before it is given up and shown as failed (PRD §20.3). */
export const GIVE_UP_AFTER_MS = 3 * 24 * 3600_000;

/** A new order is sometimes not readable for a moment. Three looks, then it is "not found". */
export const NOT_FOUND_TRIES = 3;

interface EventRow {
  id: string;
  external_event_id: string;
  event_type: string;
  scalev_order_id: string | null;
  process_status: string;
  attempt_count: number;
  received_at: Date | string;
  payload_minimal: Record<string, unknown>;
}

async function loadEvent(db: Db, id: string): Promise<EventRow | null> {
  const rows = await db.asService((q) =>
    q.query<EventRow>(
      `select id, external_event_id, event_type, scalev_order_id, process_status, attempt_count, received_at, payload_minimal
       from public.webhook_events where id = $1::uuid and provider = 'scalev'`,
      [id],
    ),
  );
  return rows[0] ?? null;
}

const setEvent = (db: Db, id: string, status: string, note: string | null, now: Date, finished: boolean) =>
  db.asService((q) =>
    q.query(
      `update public.webhook_events set process_status = $2, error_message = $3, processed_at = case when $5 then $4::timestamptz else processed_at end
       where id = $1::uuid and process_status not in ('done', 'ignored')`,
      [id, status, note, now.toISOString(), finished],
    ),
  );

/** The job types of the Scalev integration (SCALEV-AUTH-PLAN §4). Each handler is safe to run twice. */
export function scalevHandlers(svc: Services): JobHandlers {
  return {
    [JOB_TYPES.scalevEvent]: (job) => handleEvent(svc, job),
    [JOB_TYPES.scalevSweep]: async () => ({ ...(await sweepOrders(svc, { windowHours: 72 })) }),
    // A daily look further back (14 days) for orders whose webhook was lost for good.
    [JOB_TYPES.scalevSweepDeep]: async () => ({ ...(await sweepOrders(svc, { windowHours: 14 * 24 })) }),
    [JOB_TYPES.scalevPurge]: async () => ({ ...(await purgePayloads(svc)) }),
  };
}

/**
 * One webhook event. The payload is a trigger only: the order is read back from the Scalev API and every decision
 * (paid, which product, whose email and phone) is made on that reading. Nothing from the webhook body reaches an
 * entitlement. Logs carry ids and outcomes, never an email, phone or name.
 */
async function handleEvent(svc: Services, job: JobRow): Promise<Record<string, unknown>> {
  const id = job.payload.webhook_event_id;
  if (typeof id !== "string" || !UUID_RE.test(id))
    throw new JobError("scalev_event needs payload.webhook_event_id", false);
  const ev = await loadEvent(svc.db, id);
  if (!ev) throw new JobError("scalev_event: webhook event not found", false);
  if (["done", "failed", "ignored"].includes(ev.process_status)) return { skipped: ev.process_status };

  const now = svc.now();
  const rt = svc.scalev;
  const orderId = ev.scalev_order_id;
  if (!orderId) {
    await setEvent(svc.db, ev.id, "ignored", "missing_order_id", now, true);
    return { outcome: "ignored", reason: "missing_order_id" };
  }
  if (now.getTime() - new Date(ev.received_at).getTime() > GIVE_UP_AFTER_MS) {
    await setEvent(svc.db, ev.id, "failed", "NOT_VERIFIED_IN_3_DAYS", now, true);
    return { outcome: "failed", reason: "NOT_VERIFIED_IN_3_DAYS" };
  }
  await svc.db.asService((q) =>
    q.query("update public.webhook_events set attempt_count = attempt_count + 1 where id = $1::uuid", [ev.id]),
  );
  const attempt = ev.attempt_count + 1;

  // A payment event that says it is not paid is not a payment event. Looked at, logged, not acted on.
  const claimed = typeof ev.payload_minimal.payment_status === "string" ? ev.payload_minimal.payment_status : null;
  if (ev.event_type === "payment.received" && claimed !== null && !PAID_STATUSES.has(claimed)) {
    svc.log("scalev_anomaly", { event_id: ev.id, reason: "payment_received_but_not_paid", claimed });
    await setEvent(svc.db, ev.id, "ignored", "payment_status_not_paid", now, true);
    return { outcome: "ignored", reason: "payment_status_not_paid" };
  }

  // No API key or no pepper: nothing can be verified. The event waits and the admin health page says why.
  if (!rt.client || !rt.pepper) {
    await waitAndRetry(svc, ev, "SCALEV_NOT_CONFIGURED", 6 * 3600, now);
    return { outcome: "waiting", reason: "SCALEV_NOT_CONFIGURED" };
  }

  let order: ScalevOrder;
  try {
    order = await rt.client.getOrder(orderId);
  } catch (e) {
    if (!(e instanceof ScalevApiError)) throw e;
    return handleApiError(svc, ev, e, attempt, now);
  }

  const verdict = evaluateOrder(order, rt.config, rt.pepper);
  const state = await orderState(svc.db, order.id);

  if (!verdict.paid) {
    // Access that exists stays. A problem found later is only flagged for an admin (PROVISIONAL Q7).
    if (state.hasEntitlement) {
      const r = await applyOrder(svc.db, order, { ...verdict, quarantine: "post_payment_change" }, ev.id, now);
      svc.log("scalev_event_done", {
        event_id: ev.id,
        order_id: order.id,
        outcome: "flagged_after_payment",
        reason: r.quarantine_reason,
      });
      return { outcome: "flagged", reason: "post_payment_change" };
    }
    // A payment that the API does not show yet: look again (AUTH-08). Other events only refresh what we know.
    if (ev.event_type === "payment.received" && !verdict.dead) {
      const delay = awaitingDelaySeconds(attempt);
      await waitAndRetry(svc, ev, "NOT_PAID_YET", delay, now);
      return { outcome: "waiting", reason: "not_paid", retry_in_s: delay, attempt };
    }
    await setEvent(svc.db, ev.id, "done", verdict.dead ? "canceled_unpaid" : "not_paid", now, true);
    return { outcome: "done", reason: verdict.dead ? "canceled_unpaid" : "not_paid" };
  }

  const r = await applyOrder(svc.db, order, verdict, ev.id, now);
  const outcome = r.skipped
    ? "skipped"
    : r.entitlement_created
      ? "granted"
      : r.quarantine_reason
        ? "quarantined"
        : "already_granted";
  svc.log("scalev_event_done", {
    event_id: ev.id,
    order_id: order.id,
    outcome,
    reason: r.quarantine_reason ?? r.skipped ?? null,
  });
  return { outcome, reason: r.quarantine_reason ?? r.skipped ?? null };
}

/** Marks the event as waiting and files the next look as its own job (the runner's own backoff stops at 1 hour). */
async function waitAndRetry(svc: Services, ev: EventRow, note: string, delaySeconds: number, now: Date): Promise<void> {
  await setEvent(svc.db, ev.id, "awaiting_order_verification", note, now, false);
  await queue.enqueue(
    svc.db,
    JOB_TYPES.scalevEvent,
    { webhook_event_id: ev.id },
    {
      runAfter: new Date(now.getTime() + delaySeconds * 1000),
      dedupeKey: `scalev:evt:${ev.external_event_id}:retry`,
      maxAttempts: 20,
    },
  );
}

async function handleApiError(
  svc: Services,
  ev: EventRow,
  e: ScalevApiError,
  attempt: number,
  now: Date,
): Promise<Record<string, unknown>> {
  svc.log("scalev_api_error", { event_id: ev.id, kind: e.kind, status: e.status });
  if (e.kind === "auth") {
    // The key is wrong or missing a scope. Trying again cannot help (SCALEV-12). The admin health page shows this.
    await setEvent(svc.db, ev.id, "failed", "SCALEV_AUTH_REJECTED", now, true);
    throw new JobError(
      `Scalev rejected the API key (${e.status}). Check SCALEV_API_KEY and its scopes order:read and order:list.`,
      false,
    );
  }
  if (e.kind === "not_found") {
    if (attempt < NOT_FOUND_TRIES) {
      const delay = 30 * attempt;
      await waitAndRetry(svc, ev, "ORDER_NOT_FOUND_YET", delay, now);
      return { outcome: "waiting", reason: "not_found", retry_in_s: delay, attempt };
    }
    const state = await orderState(svc.db, ev.scalev_order_id!);
    if (state.hasEntitlement) {
      await flagOrder(svc.db, ev.scalev_order_id!, "post_payment_change", ev.id, now);
      return { outcome: "flagged", reason: "order_gone" };
    }
    if (ev.event_type === "order.deleted") {
      await setEvent(svc.db, ev.id, "done", "order_deleted", now, true);
      return { outcome: "done", reason: "order_deleted" };
    }
    await setEvent(svc.db, ev.id, "failed", "ORDER_NOT_FOUND", now, true);
    throw new JobError("Scalev has no order with this id (404 after several tries).", false);
  }
  // 5xx, timeout, 429, a response we cannot read: the runner tries again with backoff. The event stays "received",
  // so the sweeper also picks it up if the job runs out of attempts.
  throw new JobError(e.message, true, e.retryAfterSeconds ?? undefined);
}
