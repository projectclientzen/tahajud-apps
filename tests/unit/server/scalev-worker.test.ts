import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPhone } from "@/server/auth/crypto";
import type { PgliteDb } from "@/server/db/pglite";
import { queue } from "@/server/jobs/queue";
import { awaitingDelaySeconds } from "@/server/scalev/handlers";
import { createJobsDb, jobsByType, resetJobsTables } from "./jobs-harness";
import { FakeScalev } from "./scalev-fake";
import { ORDER_ID, PEPPER, envelope, fixture, makeWorkerEnv, type WorkerEnv } from "./scalev-harness";

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

/** An order response from a fixture, with fields of `data` replaced. */
function orderBody(name: string, patch: Record<string, unknown> = {}): unknown {
  const f = fixture<{ data: Record<string, unknown> }>(name);
  return { ...f, data: { ...f.data, ...patch } };
}
const paidEvent = (uid: string, order = ORDER_ID, data: Record<string, unknown> = {}) =>
  envelope("payment.received", uid, {
    id: order,
    order_id: "ORD-DEMO-0001",
    payment_status: "paid",
    status: "confirmed",
    ...data,
  });

const q = (sql: string, params: unknown[] = []) => db.exec(sql, params);
const ents = () => q("select * from public.access_entitlements order by created_at");
const orders = () => q("select * from public.purchase_orders order by created_at");
const events = () =>
  q(
    "select external_event_id, process_status, error_message, attempt_count from public.webhook_events order by received_at, external_event_id",
  );

async function run(w: WorkerEnv, ...bodies: unknown[]) {
  for (const b of bodies) expect(await w.webhook(b)).toBe(200);
  return w.drain();
}

describe("SCALEV-06 paid, then settled: one entitlement", () => {
  it("a paid order becomes one active entitlement with no user, and the order keeps the phone hash", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    const r = await run(w, paidEvent("evt-1"));
    expect(r.byType.scalev_event).toBe(1);
    expect(fake.count(`/v3/orders/${ORDER_ID}`)).toBe(1);
    const [ent] = await ents();
    expect(ent).toMatchObject({
      email_normalized: "pembeli.demo@example.test",
      status: "active",
      user_id: null,
      entitlement_type: "lifetime",
      expires_at: null,
    });
    const [order] = await orders();
    expect(order).toMatchObject({
      scalev_order_id: ORDER_ID,
      scalev_order_number: "ORD-DEMO-0001",
      customer_email_normalized: "pembeli.demo@example.test",
      customer_phone_hash: hashPhone(PEPPER, "081234560001"),
      payment_status: "paid",
      verified_via: "scalev_api",
      quarantine_reason: null,
      activation_blocked: false,
    });
    expect(Number(order!.amount)).toBe(99000);
    expect(ent!.purchase_order_id).toBe(order!.id);
    expect(await events()).toEqual([
      { external_event_id: "evt-1", process_status: "done", error_message: null, attempt_count: 1 },
    ]);
    expect(await q("select variant_id, variant_sku, quantity from public.purchase_order_items")).toEqual([
      { variant_id: "5550001", variant_sku: "TT-LIFETIME", quantity: 1 },
    ]);
  });

  it("then settled arrives: still one entitlement, the status is updated", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-paid"));
    fake.onOrder(ORDER_ID, { body: fixture("order-settled.json") });
    await run(w, paidEvent("evt-settled", ORDER_ID, { payment_status: "settled" }));
    expect(await ents()).toHaveLength(1);
    expect(await orders()).toHaveLength(1);
    expect((await orders())[0]).toMatchObject({ payment_status: "settled" });
    expect((await events()).map((e) => e.process_status)).toEqual(["done", "done"]);
  });

  it("paid and settled handled at the same moment still make one entitlement", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await Promise.all([
      w.webhook(paidEvent("e1")),
      w.webhook(paidEvent("e2", ORDER_ID, { payment_status: "settled" })),
    ]);
    await Promise.all([w.drain(), w.drain()]);
    expect(await ents()).toHaveLength(1);
    expect(await orders()).toHaveLength(1);
  });

  it("the same webhook delivered twice does one GET and one entitlement", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-dup"), paidEvent("evt-dup"));
    expect(fake.count("/v3/orders/")).toBe(1);
    expect(await ents()).toHaveLength(1);
  });
});

describe("SCALEV-07 payment before order.created", () => {
  it("works without any order.created event, and a later order.created changes nothing", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-first"));
    expect(await ents()).toHaveLength(1);
    await run(w, fixture("webhook-order-created.json"));
    expect(await ents()).toHaveLength(1);
    expect(fake.count("/v3/orders/")).toBe(1); // order.created is not a trigger
  });
});

describe("the webhook payload is never believed", () => {
  it("a payload that says paid while the API says unpaid gives no access", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-unpaid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-lie"));
    expect(await ents()).toHaveLength(0);
    expect(await orders()).toHaveLength(0);
    expect((await events())[0]).toMatchObject({
      process_status: "awaiting_order_verification",
      error_message: "NOT_PAID_YET",
    });
  });

  it("email, phone and name in the payload are ignored: the entitlement uses what the API returned", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await run(
      w,
      paidEvent("evt-spoof", ORDER_ID, {
        customer: { email: "penyerang@example.test", phone: "081299990000", name: "Penyerang" },
      }),
    );
    expect((await ents())[0]).toMatchObject({ email_normalized: "pembeli.demo@example.test" });
    expect((await orders())[0]).toMatchObject({
      customer_email_normalized: "pembeli.demo@example.test",
      customer_phone_hash: hashPhone(PEPPER, "081234560001"),
    });
    expect(JSON.stringify(await q("select * from public.purchase_orders"))).not.toContain("penyerang");
  });

  it("a payment.received whose own payload says it is not paid is set aside without calling the API", async () => {
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-odd", ORDER_ID, { payment_status: "unpaid" }));
    expect(fake.seen).toHaveLength(0);
    expect((await events())[0]).toMatchObject({ process_status: "ignored", error_message: "payment_status_not_paid" });
    expect(w.logs.some((l) => l.event === "scalev_anomaly")).toBe(true);
  });

  it("an API answer about a different order is refused", async () => {
    fake.onOrder(ORDER_ID, { body: orderBody("order-paid.json", { id: OTHER_ORDER }) });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-swap"));
    expect(await ents()).toHaveLength(0);
    expect((await jobsByType(db, "scalev_event"))[0]).toMatchObject({ status: "queued" }); // tried again later
  });
});

describe("SCALEV-08 an order that is not paid yet waits", () => {
  it("is looked at again after 1, 5, 15, 60 minutes, then every 6 hours", async () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(awaitingDelaySeconds)).toEqual([60, 300, 900, 3600, 21600, 21600, 21600]);
    fake.onOrder(ORDER_ID, { body: fixture("order-unpaid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-wait"));
    let looks = 1;
    for (const wait of [60, 300, 900, 3600, 21600]) {
      const [job] = (await q(
        "select run_after from public.jobs where job_type = 'scalev_event' and status = 'queued'",
      )) as { run_after: Date }[];
      expect((new Date(job!.run_after).getTime() - w.clock.now.getTime()) / 1000, `wait ${wait}`).toBe(wait);
      await w.clock.add((wait - 1) * 1000);
      await w.drain();
      expect(fake.count("/v3/orders/")).toBe(looks); // not yet
      await w.clock.add(1000);
      await w.drain();
      expect(fake.count("/v3/orders/")).toBe(++looks);
    }
    expect(await ents()).toHaveLength(0);
    expect((await events())[0]).toMatchObject({ process_status: "awaiting_order_verification", attempt_count: 6 });
  });

  it("gives access as soon as the API shows the payment", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-unpaid.json") }, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-late"));
    expect(await ents()).toHaveLength(0);
    await w.clock.add(61_000);
    await w.drain();
    expect(await ents()).toHaveLength(1);
    expect((await events())[0]).toMatchObject({ process_status: "done", error_message: null });
    expect(await jobsByType(db, "scalev_event")).toHaveLength(2); // the first look and the second, no more
  });

  it("gives up after 3 days and shows the event as failed", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-unpaid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-never"));
    await w.clock.add(3 * 24 * 3600_000 + 60_000);
    await w.drain();
    expect((await events())[0]).toMatchObject({ process_status: "failed", error_message: "NOT_VERIFIED_IN_3_DAYS" });
    expect(await ents()).toHaveLength(0);
  });

  it("payment.failed and status changes for an order that was never paid do not start a 3 day wait", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-unpaid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, fixture("webhook-payment-failed.json"));
    expect((await events())[0]).toMatchObject({ process_status: "done", error_message: "not_paid" });
    expect(await jobsByType(db, "scalev_event")).toHaveLength(1);
  });

  it("an unpaid order that was canceled is closed at once", async () => {
    fake.onOrder(ORDER_ID, { body: orderBody("order-unpaid.json", { status: "canceled" }) });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-c"));
    expect((await events())[0]).toMatchObject({ process_status: "done", error_message: "canceled_unpaid" });
    expect(await jobsByType(db, "scalev_event")).toHaveLength(1);
  });
});

describe("SCALEV-09 quarantine: no access, and the reason is kept", () => {
  it.each([
    ["order-foreign-variant.json", "unknown_variant"],
    ["order-no-email.json", "missing_email"],
    ["order-no-phone.json", "missing_phone"],
    ["order-spam.json", "spam_flag"],
    ["order-canceled.json", "order_canceled"],
    ["order-low-amount.json", "amount_below_min"],
  ])("%s becomes %s", async (file, reason) => {
    fake.onOrder(ORDER_ID, { body: fixture(file) });
    const w = makeWorkerEnv(db, fake, T0, { env: { SCALEV_MIN_AMOUNT_IDR: "50000" } });
    await run(w, paidEvent("evt-q"));
    expect(await ents()).toHaveLength(0);
    const [order] = await orders();
    expect(order).toMatchObject({ quarantine_reason: reason, verified_via: "scalev_api" });
    expect((await events())[0]).toMatchObject({ process_status: "done", error_message: `quarantined:${reason}` });
    // nobody can activate a quarantined order
    expect(await q("select 1 from public.access_entitlements where purchase_order_id = $1", [order!.id])).toHaveLength(
      0,
    );
  });

  it("an order for another product of the store is kept without the customer's email, phone or name", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-foreign-variant.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-foreign"));
    expect((await orders())[0]).toMatchObject({
      quarantine_reason: "unknown_variant",
      customer_email_normalized: null,
      customer_phone_hash: null,
      buyer_name: null,
      scalev_order_number: "ORD-DEMO-0001",
    });
    expect(await q("select variant_id, variant_sku from public.purchase_order_items")).toEqual([
      { variant_id: "9990009", variant_sku: "OTHER-PRODUCT" },
    ]);
  });

  it("an empty allowlist quarantines everything instead of granting", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0, { env: { SCALEV_ALLOWED_VARIANT_IDS: "" } });
    await run(w, paidEvent("evt-none"));
    expect(await ents()).toHaveLength(0);
    expect((await orders())[0]).toMatchObject({ quarantine_reason: "unknown_variant" });
  });

  it("the allowlist works with a SKU, with an id, and with both", async () => {
    for (const list of ["TT-LIFETIME", "5550001", "9990009, tt-lifetime"]) {
      await resetJobsTables(db);
      await db.exec("delete from public.access_entitlements");
      await db.exec("delete from public.purchase_orders");
      await db.exec("delete from public.webhook_events");
      fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
      const w = makeWorkerEnv(db, fake, T0, { env: { SCALEV_ALLOWED_VARIANT_IDS: list } });
      await run(w, paidEvent("evt-v"));
      expect(await ents(), list).toHaveLength(1);
    }
  });

  it("a phone that is only in the delivery address still works (backup field)", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-phone-in-address-only.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-addr"));
    expect(await ents()).toHaveLength(1);
    expect((await orders())[0]).toMatchObject({
      customer_phone_hash: hashPhone(PEPPER, "081234560001"),
      customer_email_normalized: "pembeli.demo@example.test",
    });
  });
});

describe("SCALEV-12 Scalev refuses the key: not tried again", () => {
  it.each([401, 403])("%i ends the job and the event, and the sweeper does not bring it back", async (status) => {
    fake.onOrder(ORDER_ID, { status, body: { detail: "nope" } });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-auth"));
    const [job] = await jobsByType(db, "scalev_event");
    expect(job).toMatchObject({ status: "failed" });
    expect(String(job!.last_error)).toMatch(/API key/);
    expect((await events())[0]).toMatchObject({ process_status: "failed", error_message: "SCALEV_AUTH_REJECTED" });
    // a day later, a sweep and another drain: still one request
    await w.clock.add(24 * 3600_000);
    await queue.enqueue(db, "scalev_sweep", {}, { runAfter: w.clock.now });
    await w.drain();
    expect(fake.count("/v3/orders/")).toBe(1);
    expect(await ents()).toHaveLength(0);
  });
});

describe("temporary Scalev trouble is tried again with backoff", () => {
  it("5xx: the job goes back to the queue, and the second try grants", async () => {
    fake.onOrder(ORDER_ID, { status: 503, text: "maintenance" }, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    const r = await run(w, paidEvent("evt-5xx"));
    expect(r.retried).toBe(1);
    const [job] = (await q(
      "select status, run_after, last_error from public.jobs where job_type = 'scalev_event'",
    )) as { status: string; run_after: Date; last_error: string }[];
    expect(job).toMatchObject({ status: "queued" });
    expect(new Date(job!.run_after).getTime() - w.clock.now.getTime()).toBe(30_000);
    expect(job!.last_error).toMatch(/503/);
    expect((await events())[0]).toMatchObject({ process_status: "received" });
    await w.clock.add(31_000);
    await w.drain();
    expect(await ents()).toHaveLength(1);
  });

  it("429 waits as long as Scalev says (plain text body)", async () => {
    fake.onOrder(
      ORDER_ID,
      { status: 429, text: "slow down", headers: { "x-ratelimit-reset": "120" } },
      { body: fixture("order-paid.json") },
    );
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-429"));
    const [job] = (await q("select run_after from public.jobs where job_type = 'scalev_event'")) as {
      run_after: Date;
    }[];
    expect(new Date(job!.run_after).getTime() - w.clock.now.getTime()).toBe(120_000);
    await w.clock.add(119_000);
    await w.drain();
    expect(fake.count("/v3/orders/")).toBe(1);
    await w.clock.add(1000);
    await w.drain();
    expect(await ents()).toHaveLength(1);
  });

  it("a timeout is retried", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json"), delayMs: 300 }, { body: fixture("order-paid.json") });
    const { ScalevClient } = await import("@/server/scalev/client");
    const w = makeWorkerEnv(db, fake, T0, {
      client: new ScalevClient({ baseUrl: fake.url, apiKey: "sk_test_x", timeoutMs: 50 }),
    });
    const r = await run(w, paidEvent("evt-slow"));
    expect(r.retried).toBe(1);
    expect(await ents()).toHaveLength(0);
  });

  it("an answer that is not an order is retried too, and nothing is granted", async () => {
    fake.onOrder(ORDER_ID, { body: { surprise: true } });
    const w = makeWorkerEnv(db, fake, T0);
    const r = await run(w, paidEvent("evt-shape"));
    expect(r.retried).toBe(1);
    expect(await ents()).toHaveLength(0);
  });
});

describe("404", () => {
  it("is looked at three times, then the event fails and the admin can see it", async () => {
    fake.onOrder(ORDER_ID, { status: 404 });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-404"));
    await w.clock.add(31_000);
    await w.drain();
    await w.clock.add(61_000);
    const r = await w.drain();
    expect(fake.count("/v3/orders/")).toBe(3);
    expect(r.failed).toBe(1);
    expect((await events())[0]).toMatchObject({ process_status: "failed", error_message: "ORDER_NOT_FOUND" });
  });

  it("an order.deleted for an order we never knew is just closed", async () => {
    fake.onOrder(ORDER_ID, { status: 404 });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, envelope("order.deleted", "evt-del", { id: ORDER_ID }));
    await w.clock.add(31_000);
    await w.drain();
    await w.clock.add(61_000);
    await w.drain();
    expect((await events())[0]).toMatchObject({ process_status: "done", error_message: "order_deleted" });
  });
});

describe("refund and cancel after payment: flagged for an admin, access is not taken away (Q7)", () => {
  async function granted() {
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-ok"));
    expect(await ents()).toHaveLength(1);
    return w;
  }

  it("canceled", async () => {
    const w = await granted();
    const before = (await ents())[0]!;
    fake.onOrder(ORDER_ID, { body: fixture("order-canceled.json") });
    await run(w, envelope("order.status_changed", "evt-cancel", { id: ORDER_ID, status: "canceled" }));
    expect((await orders())[0]).toMatchObject({
      quarantine_reason: "post_payment_change",
      scalev_status: "canceled",
      customer_email_normalized: "pembeli.demo@example.test",
    });
    const [after] = await ents();
    expect(after).toMatchObject({ status: "active", revoked_at: null, id: before.id });
    expect((await events()).find((e) => e.external_event_id === "evt-cancel")).toMatchObject({
      process_status: "done",
      error_message: "quarantined:post_payment_change",
    });
  });

  it("payment conflict", async () => {
    const w = await granted();
    fake.onOrder(ORDER_ID, { body: orderBody("order-paid.json", { payment_status: "conflict" }) });
    await run(w, fixture("webhook-payment-failed.json"));
    expect((await orders())[0]).toMatchObject({ quarantine_reason: "post_payment_change", payment_status: "conflict" });
    expect((await ents())[0]).toMatchObject({ status: "active" });
  });

  it("the order disappears from Scalev (404 stays 404)", async () => {
    const w = await granted();
    fake.onOrder(ORDER_ID, { status: 404 });
    await run(w, envelope("order.deleted", "evt-gone", { id: ORDER_ID }));
    await w.clock.add(31_000);
    await w.drain();
    await w.clock.add(61_000);
    await w.drain();
    expect((await orders())[0]).toMatchObject({ quarantine_reason: "post_payment_change" });
    expect((await ents())[0]).toMatchObject({ status: "active" });
  });

  it("a new email in Scalev does not move the proof the buyer will activate with", async () => {
    const w = await granted();
    fake.onOrder(ORDER_ID, {
      body: orderBody("order-paid.json", {
        customer: { name: "X", email: "baru@example.test", phone: "081200000000" },
      }),
    });
    await run(w, paidEvent("evt-edit", ORDER_ID, { payment_status: "settled" }));
    expect((await orders())[0]).toMatchObject({
      customer_email_normalized: "pembeli.demo@example.test",
      customer_phone_hash: hashPhone(PEPPER, "081234560001"),
    });
    expect((await ents())[0]).toMatchObject({ email_normalized: "pembeli.demo@example.test" });
  });

  it("paid again clears the flag", async () => {
    const w = await granted();
    fake.onOrder(ORDER_ID, { body: fixture("order-canceled.json") });
    await run(w, envelope("order.status_changed", "evt-c2", { id: ORDER_ID }));
    fake.onOrder(ORDER_ID, { body: fixture("order-settled.json") });
    await run(w, paidEvent("evt-s2", ORDER_ID, { payment_status: "settled" }));
    expect((await orders())[0]).toMatchObject({ quarantine_reason: null, payment_status: "settled" });
    expect(await ents()).toHaveLength(1);
  });
});

describe("Scalev is not configured yet", () => {
  it("events wait 6 hours and say why; once the key exists they are processed", async () => {
    const w = makeWorkerEnv(db, null, T0);
    await run(w, paidEvent("evt-nokey"));
    expect(fake.seen).toHaveLength(0);
    expect((await events())[0]).toMatchObject({
      process_status: "awaiting_order_verification",
      error_message: "SCALEV_NOT_CONFIGURED",
    });
    const [job] = (await q(
      "select run_after from public.jobs where job_type = 'scalev_event' and status = 'queued'",
    )) as { run_after: Date }[];
    expect(new Date(job!.run_after).getTime() - w.clock.now.getTime()).toBe(6 * 3600_000);
    // the owner sets the key
    const { ScalevClient } = await import("@/server/scalev/client");
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    w.svc.scalev.client = new ScalevClient({ baseUrl: fake.url, apiKey: "sk_test_x" });
    await w.clock.add(6 * 3600_000 + 1000);
    await w.drain();
    expect(await ents()).toHaveLength(1);
  });
});

describe("T9 B: an old admin_manual order is no longer special", () => {
  it("keeps its access and its recorded proof; the worker only records what Scalev says now", async () => {
    const o = (
      await q(
        "insert into public.purchase_orders (scalev_order_id, customer_email_normalized, payment_status, verified_via) values ($1, 'admin@ngajigaes.test', 'paid', 'admin_manual') returning id::text as id",
        [ORDER_ID],
      )
    )[0]!.id;
    await q(
      "insert into public.access_entitlements (email_normalized, purchase_order_id, status, starts_at) values ('admin@ngajigaes.test', $1::uuid, 'active', now())",
      [o],
    );
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-adm"));
    expect((await orders())[0]).toMatchObject({ customer_email_normalized: "admin@ngajigaes.test" });
    expect(await ents()).toHaveLength(1);
    expect((await events())[0]).toMatchObject({ process_status: "done" });
  });
});

describe("the database refuses to grant on less than a paid order with email and phone", () => {
  const apply = (over: Partial<{ email: string | null; phone: string | null; pay: string; q: string | null }> = {}) =>
    q(
      "select app_private.scalev_apply_order('db-guard', 'N', $1, $2, null, $3, 'confirmed', 1, 'IDR', $4, '[]'::jsonb, null, now()) as r",
      [
        over.email === undefined ? "a@example.test" : over.email,
        over.phone === undefined ? "h".repeat(64) : over.phone,
        over.pay ?? "paid",
        over.q ?? null,
      ],
    );

  it("not paid, no email, no phone: all refused", async () => {
    await expect(apply({ pay: "unpaid" })).rejects.toThrow(/VALIDATION_ERROR/);
    await expect(apply({ email: null })).rejects.toThrow(/VALIDATION_ERROR/);
    await expect(apply({ phone: null })).rejects.toThrow(/VALIDATION_ERROR/);
    expect(await ents()).toHaveLength(0);
    expect(await orders()).toHaveLength(0);
  });

  it("two calls at once make one order and one entitlement", async () => {
    await Promise.all([apply(), apply(), apply()]);
    expect(await ents()).toHaveLength(1);
    expect(await orders()).toHaveLength(1);
  });
});

describe("logs and requests carry no personal data", () => {
  it("no email, phone or name in the worker log, and the key goes only in the Authorization header", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const w = makeWorkerEnv(db, fake, T0);
    await run(w, paidEvent("evt-log"));
    const text = JSON.stringify(w.logs);
    expect(w.logs.length).toBeGreaterThan(0);
    for (const secret of [
      "pembeli.demo",
      "example.test",
      "0812",
      "081234560001",
      "Pembeli Demo",
      "62812",
      hashPhone(PEPPER, "081234560001")!,
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(fake.seen.every((r) => r.authorization === "Bearer sk_test_fake_key_not_real")).toBe(true);
    expect(fake.seen.every((r) => r.method === "GET")).toBe(true);
  });
});
