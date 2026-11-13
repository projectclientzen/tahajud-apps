import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, attempt, createTestDb, rows } from "./harness";

const NOW = "2026-11-13T08:00:00Z";
const ENC = Buffer.from([1, 2, 3, 4]);

describe("X3 schema: Scalev intake", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });
  afterAll(async () => pg.close());

  const ingest = async (id: string, trigger = true, order: string | null = "0192f3a0-7b1c-7d2e-8a41-5c6d7e8f9a01") =>
    (
      await rows<{ r: { duplicate: boolean; id?: string; queued?: boolean } }>(
        pg,
        "select app_private.scalev_ingest_event($1, 'payment.received', $2, '{\"event\":\"payment.received\"}'::jsonb, $3, $4, $5, null, $6::timestamptz) as r",
        [id, order, ENC, "f".repeat(64), trigger, NOW],
      )
    )[0]!.r;

  it("records the event and queues one job in the same call", async () => {
    const r = await ingest("db-evt-1");
    expect(r).toMatchObject({ duplicate: false, queued: true });
    const ev = (
      await rows(
        pg,
        "select process_status, scalev_order_id, payload_encrypted is not null as sealed from public.webhook_events where external_event_id = 'db-evt-1'",
      )
    )[0];
    expect(ev).toEqual({
      process_status: "received",
      scalev_order_id: "0192f3a0-7b1c-7d2e-8a41-5c6d7e8f9a01",
      sealed: true,
    });
    const job = (
      await rows(
        pg,
        "select status, dedupe_key, max_attempts, payload->>'webhook_event_id' as ev from public.jobs where job_type = 'scalev_event'",
      )
    )[0];
    expect(job).toMatchObject({ status: "queued", dedupe_key: "scalev:evt:db-evt-1", max_attempts: 20, ev: r.id });
  });

  it("the same event id again changes nothing", async () => {
    await ingest("db-evt-2");
    const before = (
      await rows<{ n: string }>(
        pg,
        "select (select count(*) from public.webhook_events) + (select count(*) from public.jobs) as n",
      )
    )[0]!.n;
    expect(await ingest("db-evt-2")).toEqual({ duplicate: true });
    const after = (
      await rows<{ n: string }>(
        pg,
        "select (select count(*) from public.webhook_events) + (select count(*) from public.jobs) as n",
      )
    )[0]!.n;
    expect(after).toBe(before);
  });

  it("an event that is not a trigger is kept as ignored and gets no job", async () => {
    const r = await ingest("db-evt-3", false, null);
    expect(r).toMatchObject({ duplicate: false, queued: false });
    expect((await rows(pg, "select 1 from public.jobs where dedupe_key = 'scalev:evt:db-evt-3'")).length).toBe(0);
    expect(
      (await rows(pg, "select process_status from public.webhook_events where external_event_id = 'db-evt-3'"))[0],
    ).toEqual({ process_status: "ignored" });
  });

  it("refuses a call with no encrypted payload: a plain text row cannot be written through this function", async () => {
    const r = await attempt(
      pg,
      "select app_private.scalev_ingest_event('db-evt-4', 'payment.received', null, '{}'::jsonb, null, 'abc', true)",
    );
    expect(r.ok).toBe(false);
  });

  it("only the backend can call it (no anon, no signed-in user)", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      const r = await as(pg, role, role === "authenticated" ? "00000000-0000-4000-8000-0000000000f1" : null, () =>
        attempt(pg, "select app_private.scalev_ingest_event('db-evt-5', 'x', null, '{}'::jsonb, $1, 'abc', false)", [
          ENC,
        ]),
      );
      expect(r.ok, role).toBe(false);
    }
    const ok = await as(pg, "service_role", null, () =>
      attempt(pg, "select app_private.scalev_ingest_event('db-evt-6', 'x', null, '{}'::jsonb, $1, 'abc', false)", [
        ENC,
      ]),
    );
    expect(ok.ok).toBe(true);
  });

  it("the tables stay backend only: a signed-in user reads nothing from webhook_events or purchase_orders", async () => {
    for (const t of ["webhook_events", "purchase_orders", "purchase_order_items"]) {
      const r = await as(pg, "authenticated", "00000000-0000-4000-8000-0000000000f1", () =>
        attempt(pg, `select 1 from public.${t} limit 1`),
      );
      expect(r.ok, t).toBe(false);
    }
  });

  describe("orders that can be held back", () => {
    it("an order may have no email (it is quarantined, not lost)", async () => {
      const r = await attempt(
        pg,
        "insert into public.purchase_orders (scalev_order_id, customer_email_normalized, payment_status, quarantine_reason) values ('db-q-1', null, 'paid', 'missing_email')",
      );
      expect(r.ok).toBe(true);
    });

    it("quarantine_reason only takes the known reasons", async () => {
      for (const reason of [
        "unknown_variant",
        "missing_email",
        "missing_phone",
        "amount_below_min",
        "order_canceled",
        "spam_flag",
        "post_payment_change",
      ]) {
        const r = await attempt(
          pg,
          "insert into public.purchase_orders (scalev_order_id, payment_status, quarantine_reason) values ($1, 'paid', $2)",
          [`db-q-${reason}`, reason],
        );
        expect(r.ok, reason).toBe(true);
      }
      const bad = await attempt(
        pg,
        "insert into public.purchase_orders (scalev_order_id, payment_status, quarantine_reason) values ('db-q-bad', 'paid', 'because')",
      );
      expect(bad.ok).toBe(false);
    });

    it("order items need no product id, and carry the SKU", async () => {
      const o = (
        await rows<{ id: string }>(pg, "select id::text from public.purchase_orders where scalev_order_id = 'db-q-1'")
      )[0]!.id;
      const r = await attempt(
        pg,
        "insert into public.purchase_order_items (purchase_order_id, variant_id, variant_sku) values ($1::uuid, '5550001', 'TT-LIFETIME')",
        [o],
      );
      expect(r.ok).toBe(true);
    });
  });

  it("the payload retention is a provisional setting, 90 days", async () => {
    expect(
      (
        await rows(pg, "select value, provisional from public.app_settings where key = 'scalev_payload_retention_days'")
      )[0],
    ).toEqual({ value: 90, provisional: true });
  });
});
