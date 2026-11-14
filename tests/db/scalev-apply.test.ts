import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, attempt, createTestDb, rows } from "./harness";

const NOW = "2026-11-13T08:00:00Z";
const PHONE = "p".repeat(64);

describe("X6 schema: applying a verified Scalev order", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });
  afterAll(async () => pg.close());

  type Apply = {
    order_id: string;
    entitlement_created: boolean;
    entitlement_exists: boolean;
    quarantine_reason: string | null;
    skipped?: string;
  };
  const apply = async (
    o: {
      id?: string;
      email?: string | null;
      phone?: string | null;
      pay?: string;
      quarantine?: string | null;
      items?: unknown[];
      event?: string | null;
    } = {},
  ): Promise<Apply> =>
    (
      await rows<{ r: Apply }>(
        pg,
        "select app_private.scalev_apply_order($1, 'N-1', $2, $3, 'Nama', $4, 'confirmed', 99000, 'IDR', $5, $6::jsonb, $7::uuid, $8::timestamptz) as r",
        [
          o.id ?? "ord-a",
          o.email === undefined ? "buyer-a@example.test" : o.email,
          o.phone === undefined ? PHONE : o.phone,
          o.pay ?? "paid",
          o.quarantine ?? null,
          JSON.stringify(o.items ?? [{ variant_id: "5550001", variant_sku: "TT-LIFETIME", quantity: 1 }]),
          o.event ?? null,
          NOW,
        ],
      )
    )[0]!.r;
  const count = async (sql: string) => Number((await rows<{ n: string }>(pg, sql))[0]!.n);

  it("creates the order, its items and one active entitlement without a user", async () => {
    const r = await apply();
    expect(r).toMatchObject({ entitlement_created: true, entitlement_exists: true, quarantine_reason: null });
    const e = (
      await rows(
        pg,
        "select status, user_id, entitlement_type, email_normalized, starts_at from public.access_entitlements where purchase_order_id = $1::uuid",
        [r.order_id],
      )
    )[0];
    expect(e).toMatchObject({
      status: "active",
      user_id: null,
      entitlement_type: "lifetime",
      email_normalized: "buyer-a@example.test",
    });
    expect(new Date(e!.starts_at as string).toISOString()).toBe(NOW.replace("Z", ".000Z"));
    expect(
      (
        await rows(
          pg,
          "select verified_via, payment_status, customer_phone_hash from public.purchase_orders where id = $1::uuid",
          [r.order_id],
        )
      )[0],
    ).toEqual({ verified_via: "scalev_api", payment_status: "paid", customer_phone_hash: PHONE });
  });

  it("applying the same order again changes nothing: same order, one entitlement, items replaced not doubled", async () => {
    const a = await apply({ id: "ord-b", email: "buyer-b@example.test" });
    const b = await apply({ id: "ord-b", email: "buyer-b@example.test", pay: "settled" });
    expect(b).toMatchObject({ order_id: a.order_id, entitlement_created: false, entitlement_exists: true });
    expect(
      await count(
        "select count(*) as n from public.access_entitlements where purchase_order_id = '" + a.order_id + "'",
      ),
    ).toBe(1);
    expect(
      await count(
        "select count(*) as n from public.purchase_order_items where purchase_order_id = '" + a.order_id + "'",
      ),
    ).toBe(1);
    expect(
      (await rows(pg, "select payment_status from public.purchase_orders where id = $1::uuid", [a.order_id]))[0],
    ).toEqual({ payment_status: "settled" });
  });

  it("refuses to grant when not paid, or without email, or without phone proof", async () => {
    for (const bad of [{ pay: "unpaid" }, { pay: "conflict" }, { email: null }, { phone: null }]) {
      const r = await attempt(
        pg,
        "select app_private.scalev_apply_order('ord-bad', 'N', $1, $2, null, $3, 'x', 1, 'IDR', null, '[]'::jsonb, null, $4::timestamptz)",
        [
          "email" in bad ? bad.email : "x@example.test",
          "phone" in bad ? bad.phone : PHONE,
          "pay" in bad ? bad.pay : "paid",
          NOW,
        ],
      );
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
    expect(await count("select count(*) as n from public.purchase_orders where scalev_order_id = 'ord-bad'")).toBe(0);
  });

  it("a quarantined order has no entitlement, and a later quarantine never removes one that exists", async () => {
    const q = await apply({ id: "ord-q", quarantine: "missing_phone", phone: null });
    expect(q).toMatchObject({
      entitlement_created: false,
      entitlement_exists: false,
      quarantine_reason: "missing_phone",
    });
    const ok = await apply({ id: "ord-r", email: "buyer-r@example.test" });
    const later = await apply({
      id: "ord-r",
      email: "buyer-r@example.test",
      quarantine: "order_canceled",
      pay: "paid",
    });
    expect(later).toMatchObject({
      order_id: ok.order_id,
      entitlement_exists: true,
      quarantine_reason: "post_payment_change",
    });
    expect(
      (
        await rows(pg, "select status from public.access_entitlements where purchase_order_id = $1::uuid", [
          ok.order_id,
        ])
      )[0],
    ).toEqual({ status: "active" });
  });

  it("an order with an entitlement keeps its email and phone proof when Scalev data changes", async () => {
    await apply({ id: "ord-s", email: "first@example.test", phone: "1".repeat(64) });
    await apply({ id: "ord-s", email: "second@example.test", phone: "2".repeat(64) });
    expect(
      (
        await rows(
          pg,
          "select customer_email_normalized as e, customer_phone_hash as p from public.purchase_orders where scalev_order_id = 'ord-s'",
        )
      )[0],
    ).toEqual({ e: "first@example.test", p: "1".repeat(64) });
  });

  it("T9 B: a row marked admin_manual is no longer skipped; Scalev's reading applies like any order", async () => {
    await pg.query(
      "insert into public.purchase_orders (scalev_order_id, customer_email_normalized, payment_status, verified_via) values ('ord-m', 'admin@example.test', 'paid', 'admin_manual')",
    );
    const r = await apply({ id: "ord-m", email: "other@example.test" });
    expect(r).toMatchObject({ entitlement_created: true });
    expect(r.skipped).toBeUndefined();
    expect(
      (
        await rows(
          pg,
          "select customer_email_normalized as e, verified_via as v from public.purchase_orders where scalev_order_id = 'ord-m'",
        )
      )[0],
    ).toEqual({ e: "other@example.test", v: "scalev_api" });
  });

  it("marks the webhook event done in the same call, with the quarantine reason when there is one", async () => {
    const ev = (
      await rows<{ id: string }>(
        pg,
        "insert into public.webhook_events (provider, external_event_id, event_type, payload_sha256) values ('scalev', 'sql-ev-1', 'payment.received', 'x') returning id::text as id",
      )
    )[0]!.id;
    await apply({ id: "ord-e", quarantine: "spam_flag", event: ev });
    expect(
      (
        await rows(
          pg,
          "select process_status, error_message, processed_at is not null as at from public.webhook_events where id = $1::uuid",
          [ev],
        )
      )[0],
    ).toEqual({ process_status: "done", error_message: "quarantined:spam_flag", at: true });
  });

  it("the flag function marks an order only when access was given, and never touches the entitlement", async () => {
    const ok = await apply({ id: "ord-f", email: "buyer-f@example.test" });
    await apply({ id: "ord-g", quarantine: "unknown_variant", email: null, phone: null });
    const flag = async (id: string) =>
      (
        await rows<{ r: boolean }>(
          pg,
          "select app_private.scalev_flag_order($1, 'post_payment_change', null, $2::timestamptz) as r",
          [id, NOW],
        )
      )[0]!.r;
    expect(await flag("ord-f")).toBe(true);
    expect(await flag("ord-g")).toBe(false);
    expect(await flag("no-such-order")).toBe(false);
    expect(
      (
        await rows(pg, "select status, revoked_at from public.access_entitlements where purchase_order_id = $1::uuid", [
          ok.order_id,
        ])
      )[0],
    ).toEqual({ status: "active", revoked_at: null });
  });

  it("only the backend can call these functions", async () => {
    const calls = [
      "select app_private.scalev_apply_order('x', null, null, null, null, 'paid', null, null, null, 'spam_flag', '[]'::jsonb, null, now())",
      "select app_private.scalev_flag_order('x', 'post_payment_change', null, now())",
      "select app_private.scalev_self_heal(now())",
      "select app_private.scalev_purge_payloads(now())",
    ];
    for (const role of ["anon", "authenticated"] as const) {
      for (const sql of calls) {
        const r = await as(pg, role, role === "authenticated" ? "00000000-0000-4000-8000-0000000000f1" : null, () =>
          attempt(pg, sql),
        );
        expect(r.ok, `${role}: ${sql}`).toBe(false);
      }
    }
    for (const sql of calls.slice(1))
      expect((await as(pg, "service_role", null, () => attempt(pg, sql))).ok, sql).toBe(true);
  });

  it("every function is pinned to an empty search_path", async () => {
    const f = await rows<{ proname: string; cfg: string[] | null }>(
      pg,
      "select proname, proconfig as cfg from pg_proc where pronamespace = 'app_private'::regnamespace and proname like 'scalev\\_%'",
    );
    expect(f.map((x) => x.proname).sort()).toEqual([
      "scalev_apply_order",
      "scalev_flag_order",
      "scalev_ingest_event",
      "scalev_purge_payloads",
      "scalev_self_heal",
    ]);
    for (const x of f) expect((x.cfg ?? []).join(","), x.proname).toMatch(/search_path=("")?$|search_path=""/);
  });
});
