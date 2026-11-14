import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PgliteDb } from "@/server/db/pglite";
import { queue } from "@/server/jobs/queue";
import { tick } from "@/server/jobs/tick";
import { sweepOrders } from "@/server/scalev/sweep";
import { createJobsDb, jobsByType, resetJobsTables } from "./jobs-harness";
import { FakeScalev } from "./scalev-fake";
import { ORDER_ID, envelope, fixture, makeWorkerEnv, type WorkerEnv } from "./scalev-harness";

let db: PgliteDb;
let fake: FakeScalev;
beforeAll(async () => {
  db = await createJobsDb();
  fake = await FakeScalev.start();
});
afterAll(async () => {
  await fake.stop();
  await db.close();
});
beforeEach(async () => {
  await resetJobsTables(db);
  await db.exec("delete from public.access_entitlements");
  await db.exec("delete from public.purchase_orders");
  await db.exec("delete from public.webhook_events");
  fake.reset();
});

const T0 = "2026-11-13T08:00:00Z";
const OTHER_ORDER = "0192f3a0-7b1c-7d2e-8a41-5c6d7e8f9a02";
const THIRD_ORDER = "0192f3a0-7b1c-7d2e-8a41-5c6d7e8f9a03";

type Row = Record<string, unknown>;
const orderRow = (id: string, patch: Row = {}): Row => ({
  ...fixture<{ data: Row }>("order-paid.json").data,
  id,
  ...patch,
});
const page = (results: Row[], nextCursor: string | null = null): { body: unknown } => ({
  body: { code: 200, status: "success", data: { results, has_next: nextCursor !== null, next_cursor: nextCursor } },
});
const q = (sql: string, params: unknown[] = []) => db.exec(sql, params);
const ents = () => q("select * from public.access_entitlements");
const events = () =>
  q(
    "select external_event_id, process_status, error_message, event_type, scalev_order_id from public.webhook_events order by external_event_id",
  );

async function sweep(w: WorkerEnv, type: "scalev_sweep" | "scalev_sweep_deep" = "scalev_sweep") {
  await queue.enqueue(db, type, {}, { runAfter: w.clock.now });
  return w.drain();
}

describe("SCALEV-11 the sweeper finds paid orders whose webhook never came", () => {
  it("files one synthetic event for an unknown paid order, and the normal path grants it", async () => {
    fake.onList("paid", page([orderRow(ORDER_ID, { created_at: "2026-11-13T07:00:00Z" })]));
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    const r = await sweep(w);
    expect(r.byType).toMatchObject({ scalev_sweep: 1, scalev_event: 1 });
    expect(await events()).toEqual([
      {
        external_event_id: `poll:${ORDER_ID}:paid`,
        process_status: "done",
        error_message: null,
        event_type: "payment.received",
        scalev_order_id: ORDER_ID,
      },
    ]);
    // the decision still came from a GET of the order, not from the list
    expect(fake.count(`/v3/orders/${ORDER_ID}`)).toBe(1);
    expect(await ents()).toHaveLength(1);
    expect(Object.fromEntries(fake.seen[0]!.query)).toMatchObject({ store_id: "2785", payment_status: "paid" });
  });

  it("looks at both paid and settled orders", async () => {
    fake.onList("paid", page([]));
    fake.onList("settled", page([orderRow(ORDER_ID, { payment_status: "settled" })]));
    fake.onOrder(ORDER_ID, { body: fixture("order-settled.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await sweep(w);
    expect((await events())[0]).toMatchObject({ external_event_id: `poll:${ORDER_ID}:settled` });
    expect(await ents()).toHaveLength(1);
  });

  it("an order it already knows is not filed again, on this sweep or the next", async () => {
    fake.onList("paid", page([orderRow(ORDER_ID)]));
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await sweep(w);
    await w.clock.add(11 * 60_000);
    const r = await sweep(w);
    expect(r.byType.scalev_event ?? 0).toBe(0);
    expect(fake.count("/v3/orders/")).toBe(1);
    expect(await events()).toHaveLength(1);
    expect(await ents()).toHaveLength(1);
  });

  it("an order that is held back counts as known, so it is not fetched every 10 minutes", async () => {
    fake.onList("paid", page([orderRow(ORDER_ID)]));
    fake.onOrder(ORDER_ID, { body: fixture("order-no-email.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await sweep(w);
    await w.clock.add(11 * 60_000);
    await sweep(w);
    expect(fake.count("/v3/orders/")).toBe(1);
    expect(await ents()).toHaveLength(0);
  });

  it("orders for other products of the store are skipped without a GET and leave no record", async () => {
    fake.onList(
      "paid",
      page([orderRow(OTHER_ORDER, { orderlines: [{ variant: 9990009, variant_sku: "OTHER-PRODUCT" }] })]),
    );
    const w = makeWorkerEnv(db, fake, T0);
    const out = await sweepOrders(w.svc, { windowHours: 72 });
    expect(out).toMatchObject({ listed: 1, skippedOtherProduct: 1, enqueued: 0, polling: "done" });
    expect(fake.count("/v3/orders/")).toBe(0);
    expect(await events()).toHaveLength(0);
    expect(await q("select 1 from public.purchase_orders")).toHaveLength(0);
  });

  it("follows the cursor to the next page, and stops at the page limit", async () => {
    fake.onList("paid", page([orderRow(ORDER_ID)], "p2"));
    fake.onList("paid", page([orderRow(OTHER_ORDER)], "p3"), "p2");
    fake.onList("paid", page([orderRow(THIRD_ORDER)]), "p3");
    const w = makeWorkerEnv(db, fake, T0);
    const out = await sweepOrders(w.svc, { windowHours: 72 });
    expect(out).toMatchObject({ listed: 3, enqueued: 3 });
    expect(fake.seen.filter((r) => r.path === "/v3/orders").map((r) => r.query.get("cursor"))).toEqual([
      null,
      "p2",
      "p3",
      null,
    ]);
    // a list that never ends is cut off at 8 pages per status
    fake.reset();
    for (let i = 0; i < 20; i++) fake.onList("paid", page([], `c${i + 1}`), i === 0 ? "" : `c${i}`);
    await sweepOrders(w.svc, { windowHours: 72 });
    expect(fake.seen.filter((r) => r.query.get("payment_status") === "paid")).toHaveLength(8);
  });

  it("stops at a page that lies entirely outside the window; a partly old page is read on (T9 F9)", async () => {
    fake.onList(
      "paid",
      page(
        [
          orderRow(ORDER_ID, { created_at: "2026-11-13T06:00:00Z" }),
          orderRow(OTHER_ORDER, { created_at: "2026-11-01T00:00:00Z" }),
        ],
        "more",
      ),
    );
    fake.onList("paid", page([orderRow(THIRD_ORDER, { created_at: "2026-11-02T00:00:00Z" })], "more2"), "more");
    fake.onList("paid", page([orderRow("0192f3a0-7b1c-7d2e-8a41-5c6d7e8f9a04", { created_at: "2026-11-01T00:00:00Z" })]), "more2");
    const w = makeWorkerEnv(db, fake, T0);
    const out = await sweepOrders(w.svc, { windowHours: 72 });
    expect(out.enqueued).toBe(1);
    // page 1 (partly old) was followed to page 2; page 2 is entirely old, so page 3 was not asked for
    expect(fake.seen.filter((r) => r.query.get("payment_status") === "paid")).toHaveLength(2);
    // the daily deep sweep looks 14 days back: it finds the older orders too.
    // The first order is not counted again: its event already exists.
    const deep = await sweepOrders(w.svc, { windowHours: 14 * 24 });
    expect(deep.enqueued).toBe(3);
    expect(await events()).toHaveLength(4);
  });

  it("an old order paid just now is found: the window follows the payment time, with createdAt as the fallback (T9 F9)", async () => {
    fake.onList(
      "paid",
      page([
        orderRow(ORDER_ID, { created_at: "2026-10-01T00:00:00Z", paid_time: "2026-11-13T07:00:00Z" }),
        orderRow(OTHER_ORDER, { created_at: "2026-11-13T06:00:00Z", paid_time: "2026-10-02T00:00:00Z" }),
        orderRow(THIRD_ORDER, { created_at: "2026-11-13T06:00:00Z" }),
      ]),
    );
    const w = makeWorkerEnv(db, fake, T0);
    const out = await sweepOrders(w.svc, { windowHours: 72 });
    expect(out.enqueued).toBe(2); // ORDER_ID (paid in window) and THIRD_ORDER (no payment time, created in window)
    expect((await events()).map((e) => e.scalev_order_id).sort()).toEqual([ORDER_ID, THIRD_ORDER].sort());
  });

  it("the deep sweep is its own recurring job and uses the longer window", async () => {
    fake.onList("paid", page([orderRow(ORDER_ID, { created_at: "2026-11-05T00:00:00Z" })]));
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await sweep(w, "scalev_sweep");
    expect(await events()).toHaveLength(0);
    await sweep(w, "scalev_sweep_deep");
    expect(await events()).toHaveLength(1);
    expect(await ents()).toHaveLength(1);
  });

  it("is created by the tick: every 10 minutes, the deep one and the purge every day", async () => {
    const w = makeWorkerEnv(db, fake, T0);
    const t = await tick(w.svc);
    expect(t.enqueued).toEqual(expect.arrayContaining(["scalev_sweep", "scalev_sweep_deep", "scalev_purge"]));
    await w.clock.add(11 * 60_000);
    const t2 = await tick(w.svc);
    expect(t2.enqueued).toContain("scalev_sweep");
    expect(t2.enqueued).not.toContain("scalev_purge");
  });
});

describe("the sweep when it cannot poll", () => {
  it("can be turned off, and still heals", async () => {
    const w = makeWorkerEnv(db, fake, T0, { env: { SCALEV_SWEEP_ENABLED: "false" } });
    const out = await sweepOrders(w.svc, { windowHours: 72 });
    expect(out.polling).toBe("disabled");
    expect(fake.seen).toHaveLength(0);
  });

  it("says so when the store id, the key or the allowlist is missing", async () => {
    for (const env of [{ SCALEV_STORE_ID: "" }, { SCALEV_ALLOWED_VARIANT_IDS: "" }]) {
      const w = makeWorkerEnv(db, fake, T0, { env });
      expect((await sweepOrders(w.svc, { windowHours: 72 })).polling).toBe("not_configured");
    }
    const noKey = makeWorkerEnv(db, null, T0);
    expect((await sweepOrders(noKey.svc, { windowHours: 72 })).polling).toBe("not_configured");
    expect(fake.seen).toHaveLength(0);
  });

  it("a list it cannot read is reported as NEEDS_VERIFICATION and does not fail the job", async () => {
    fake.onList("paid", { body: { something: "else" } });
    const w = makeWorkerEnv(db, fake, T0);
    const r = await sweep(w);
    expect(await jobsByType(db, "scalev_sweep")).toMatchObject([{ status: "done" }]);
    expect(r.failed).toBe(0);
    const out = await sweepOrders(w.svc, { windowHours: 72 });
    expect(out).toMatchObject({ polling: "NEEDS_VERIFICATION" });
  });

  it("401 from Scalev ends the job for good (SCALEV-12)", async () => {
    fake.onList("paid", { status: 401, body: {} });
    const w = makeWorkerEnv(db, fake, T0);
    const r = await sweep(w);
    expect(r.failed).toBe(1);
    expect((await jobsByType(db, "scalev_sweep"))[0]).toMatchObject({ status: "failed" });
    expect(fake.seen).toHaveLength(1);
  });

  it("5xx is retried", async () => {
    fake.onList("paid", { status: 502, text: "bad gateway" });
    const w = makeWorkerEnv(db, fake, T0);
    const r = await sweep(w);
    expect(r.retried).toBe(1);
    expect((await jobsByType(db, "scalev_sweep"))[0]).toMatchObject({ status: "queued" });
  });
});

describe("self-heal: events nobody is working on", () => {
  async function stuckEvent(w: WorkerEnv, id: string, ageMs: number, status = "received") {
    expect(await w.webhook(envelope("payment.received", id, { id: ORDER_ID, payment_status: "paid" }))).toBe(200);
    await q("delete from public.jobs");
    await q(
      "update public.webhook_events set process_status = $2, received_at = $3::timestamptz where external_event_id = $1",
      [id, status, new Date(w.clock.now.getTime() - ageMs).toISOString()],
    );
  }

  it("an event received minutes ago with no job gets a job; a younger one is left alone", async () => {
    const w = makeWorkerEnv(db, fake, T0);
    await stuckEvent(w, "old", 6 * 60_000);
    const out = await sweepOrders(w.svc, { windowHours: 72 });
    expect(out.heal).toEqual({ given_up: 0, requeued: 1 });
    expect(await jobsByType(db, "scalev_event")).toMatchObject([
      { status: "queued", dedupe_key: "scalev:evt:old:heal" },
    ]);
    await q("delete from public.jobs");
    await q("update public.webhook_events set received_at = $1::timestamptz", [
      new Date(w.clock.now.getTime() - 60_000).toISOString(),
    ]);
    expect((await sweepOrders(w.svc, { windowHours: 72 })).heal.requeued).toBe(0);
  });

  it("an event with a job already queued or running gets no second one", async () => {
    const w = makeWorkerEnv(db, fake, T0);
    expect(await w.webhook(envelope("payment.received", "has-job", { id: ORDER_ID, payment_status: "paid" }))).toBe(
      200,
    );
    await q("update public.webhook_events set received_at = $1::timestamptz", [
      new Date(w.clock.now.getTime() - 3600_000).toISOString(),
    ]);
    expect((await sweepOrders(w.svc, { windowHours: 72 })).heal.requeued).toBe(0);
    expect(await jobsByType(db, "scalev_event")).toHaveLength(1);
  });

  it("a waiting event whose job is gone is brought back, and then processed", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await stuckEvent(w, "waiting", 3600_000, "awaiting_order_verification");
    await sweep(w);
    expect(await ents()).toHaveLength(1);
  });

  it("an event older than 3 days is given up, not retried forever", async () => {
    const w = makeWorkerEnv(db, fake, T0);
    await stuckEvent(w, "ancient", 3 * 24 * 3600_000 + 1000);
    const out = await sweepOrders(w.svc, { windowHours: 72 });
    expect(out.heal).toEqual({ given_up: 1, requeued: 0 });
    expect((await events())[0]).toMatchObject({ process_status: "failed", error_message: "NOT_VERIFIED_IN_3_DAYS" });
  });

  it("failed events are not brought back (an auth error is for a person to fix)", async () => {
    const w = makeWorkerEnv(db, fake, T0);
    await stuckEvent(w, "failed-one", 3600_000, "failed");
    expect((await sweepOrders(w.svc, { windowHours: 72 })).heal.requeued).toBe(0);
  });
});

describe("purge: payloads older than the retention are emptied", () => {
  it("empties payload_encrypted after 90 days and keeps the row and the newer payloads", async () => {
    const w = makeWorkerEnv(db, fake, T0);
    for (const id of ["new", "old"]) expect(await w.webhook(envelope("order.updated", id))).toBe(200);
    await q("update public.webhook_events set received_at = $1::timestamptz where external_event_id = 'old'", [
      new Date(w.clock.now.getTime() - 91 * 24 * 3600_000).toISOString(),
    ]);
    await queue.enqueue(db, "scalev_purge", {}, { runAfter: w.clock.now });
    const r = await w.drain();
    expect(r.byType.scalev_purge).toBe(1);
    const rows = await q(
      "select external_event_id, payload_encrypted is null as purged, payload_sha256 is not null as has_hash from public.webhook_events order by 1",
    );
    expect(rows).toEqual([
      { external_event_id: "new", purged: false, has_hash: true },
      { external_event_id: "old", purged: true, has_hash: true },
    ]);
  });

  it("89 days stays, and the retention is a setting", async () => {
    const w = makeWorkerEnv(db, fake, T0);
    expect(await w.webhook(envelope("order.updated", "mid"))).toBe(200);
    await q("update public.webhook_events set received_at = $1::timestamptz", [
      new Date(w.clock.now.getTime() - 89 * 24 * 3600_000).toISOString(),
    ]);
    const purge = () =>
      q("select app_private.scalev_purge_payloads($1::timestamptz) as n", [w.clock.now.toISOString()]);
    expect((await purge())[0]!.n).toBe(0);
    await q("update public.app_settings set value = '30'::jsonb where key = 'scalev_payload_retention_days'");
    try {
      expect((await purge())[0]!.n).toBe(1);
    } finally {
      await q("update public.app_settings set value = '90'::jsonb where key = 'scalev_payload_retention_days'");
    }
  });
});
