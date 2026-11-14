/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildMigration, REGIONS_OUT } from "../../scripts/db-regions";
import { attempt, createTestDb, createUser, rows } from "./harness";

const NOW = "2026-11-18T03:00:00Z";
const PH = "a".repeat(64);
const OTHER_PH = "b".repeat(64);
const PW = "$scrypt$ln=15,r=8,p=3$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g";
const plus = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();

describe("T9 migration: failure gate, linking, roles, export", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  }, 60_000);
  afterAll(async () => pg.close());

  describe("F1/F2 auth_gate", () => {
    const gate = async (key: string, now: string, free = 2, delays = "{60,120,300}") =>
      (await rows<{ r: { allowed: boolean; retry_after_seconds: number } }>(pg, "select app_private.auth_gate($1, $2::timestamptz, $3, $4::int[], 3600) as r", [key, now, free, delays]))[0]!.r;

    it("free attempts, then 60, 120, 300 seconds and the last step repeats; refused calls are not counted", async () => {
      expect((await gate("g1", NOW)).allowed).toBe(true);
      expect((await gate("g1", NOW)).allowed).toBe(true);
      expect((await gate("g1", NOW)).allowed).toBe(true); // 3rd attempt sets the 60 s wait
      expect(await gate("g1", plus(1000))).toEqual({ allowed: false, retry_after_seconds: 59 });
      for (let i = 0; i < 4; i++) await gate("g1", plus(2000)); // hammering during the wait changes nothing
      expect((await gate("g1", plus(61_000))).allowed).toBe(true); // 4th attempt: 120 s
      expect((await gate("g1", plus(62_000))).allowed).toBe(false);
      expect((await gate("g1", plus(61_000 + 121_000))).allowed).toBe(true); // 5th: 300 s
      expect((await gate("g1", plus(61_000 + 121_000 + 301_000))).allowed).toBe(true); // 6th: 300 s again
      expect((await rows<any>(pg, "select fails from public.auth_fail_state where key = 'g1'"))[0].fails).toBe(6);
    });

    it("a quiet key starts again from zero; clear and refund give slots back", async () => {
      for (let i = 0; i < 4; i++) await gate("g2", NOW);
      expect((await gate("g2", plus(2 * 3600_000))).allowed).toBe(true);
      expect((await rows<any>(pg, "select fails from public.auth_fail_state where key = 'g2'"))[0].fails).toBe(1);
      await pg.query("select app_private.auth_gate_refund('g2', $1::timestamptz)", [plus(2 * 3600_000)]);
      expect((await rows<any>(pg, "select fails from public.auth_fail_state where key = 'g2'"))[0].fails).toBe(0);
      await pg.query("select app_private.auth_gate_clear('g2')");
      expect(await rows(pg, "select 1 from public.auth_fail_state where key = 'g2'")).toHaveLength(0);
    });

    it("parallel calls on one key are serialized: at most free + 1 pass", async () => {
      const res = await Promise.all(Array.from({ length: 30 }, () => gate("g3", NOW, 5, "{900}")));
      expect(res.filter((r) => r.allowed).length).toBeLessThanOrEqual(6);
    });

    it("is not reachable by the browser roles", async () => {
      for (const fn of ["auth_gate", "auth_gate_clear", "auth_gate_refund", "rate_refund"]) {
        const r = await rows<{ ok: boolean }>(
          pg,
          `select has_function_privilege('authenticated', p.oid, 'execute') as ok from pg_proc p where p.pronamespace = 'app_private'::regnamespace and p.proname = $1`,
          [fn],
        );
        expect(r.length).toBeGreaterThan(0);
        for (const x of r) expect(x.ok, fn).toBe(false);
      }
    });
  });

  describe("F4 scalev_apply_order links to an existing account only when the phone matches", () => {
    const apply = async (id: string, email: string, phone: string) =>
      (await rows<{ r: any }>(pg, "select app_private.scalev_apply_order($1, 'N', $2, $3, 'Nama', 'paid', 'confirmed', 99000, 'IDR', null, '[]'::jsonb, null, $4::timestamptz) as r", [id, email, phone, NOW]))[0]!.r;
    const account = async (email: string, phone: string, entStatus = "active") => {
      const uid = (await rows<{ id: string }>(pg, "insert into auth.users (email) values ($1) returning id::text", [email]))[0]!.id;
      await pg.query("insert into public.profiles (user_id, email_normalized) values ($1::uuid, $2)", [uid, email]);
      const o = (await rows<{ id: string }>(pg, "insert into public.purchase_orders (scalev_order_id, customer_email_normalized, customer_phone_hash, payment_status, verified_via) values ($1, $2, $3, 'paid', 'scalev_api') returning id::text", [`first-${email}`, email, phone]))[0]!.id;
      await pg.query("insert into public.access_entitlements (user_id, email_normalized, purchase_order_id, status, starts_at) values ($1::uuid, $2, $3::uuid, $4, '2026-01-01T00:00:00Z')", [uid, email, o, entStatus]);
      return uid;
    };

    it("a repeat purchase after access was revoked links to the account on its own", async () => {
      const uid = await account("again@example.test", PH, "revoked");
      const r = await apply("again-2", "again@example.test", PH);
      expect(r).toMatchObject({ entitlement_created: true, quarantine_reason: null });
      const e = await rows<any>(pg, "select user_id::text as u, status from public.access_entitlements e join public.purchase_orders o on o.id = e.purchase_order_id where o.scalev_order_id = 'again-2'");
      expect(e).toEqual([{ u: uid, status: "active" }]);
    });

    it("the same email with a phone that matches no order of that account is held for CS and creates no access", async () => {
      await account("victim@example.test", PH);
      const r = await apply("stranger-1", "victim@example.test", OTHER_PH);
      expect(r).toMatchObject({ entitlement_created: false, quarantine_reason: "needs_cs_review" });
      expect(await rows(pg, "select 1 from public.access_entitlements e join public.purchase_orders o on o.id = e.purchase_order_id where o.scalev_order_id = 'stranger-1'")).toHaveLength(0);
      expect((await rows<any>(pg, "select quarantine_reason from public.purchase_orders where scalev_order_id = 'stranger-1'"))[0]).toEqual({ quarantine_reason: "needs_cs_review" });
    });

    it("an email with no account still gets an unlinked entitlement for activation", async () => {
      const r = await apply("fresh-1", "fresh@example.test", PH);
      expect(r).toMatchObject({ entitlement_created: true });
      expect((await rows<any>(pg, "select e.user_id from public.access_entitlements e join public.purchase_orders o on o.id = e.purchase_order_id where o.scalev_order_id = 'fresh-1'"))[0]).toEqual({ user_id: null });
    });

    it("running the same order twice does not link or hold it again", async () => {
      await account("twice@example.test", PH);
      const a = await apply("twice-2", "twice@example.test", PH);
      const b = await apply("twice-2", "twice@example.test", PH);
      expect(a.entitlement_created).toBe(true);
      expect(b).toMatchObject({ entitlement_created: false, entitlement_exists: true });
    });
  });

  describe("F6 roles", () => {
    const reset = async (email: string, phone: string) =>
      (await rows<{ r: any }>(pg, "select app_private.reset_password_self($1, $2, $3, 'iph', $4::timestamptz) as r", [email, phone, PW, NOW]))[0]!.r;
    const buyer = async (email: string, roles: string[]) => {
      const uid = (await rows<{ id: string }>(pg, "insert into auth.users (email) values ($1) returning id::text", [email]))[0]!.id;
      await pg.query("insert into public.profiles (user_id, email_normalized) values ($1::uuid, $2)", [uid, email]);
      await pg.query("insert into public.auth_credentials (user_id, password_hash, password_changed_at) values ($1::uuid, $2, $3::timestamptz)", [uid, PW, NOW]);
      const o = (await rows<{ id: string }>(pg, "insert into public.purchase_orders (scalev_order_id, customer_email_normalized, customer_phone_hash, payment_status, verified_via) values ($1, $2, $3, 'paid', 'scalev_api') returning id::text", [`b-${email}`, email, PH]))[0]!.id;
      await pg.query("insert into public.access_entitlements (user_id, email_normalized, purchase_order_id, status, starts_at) values ($1::uuid, $2, $3::uuid, 'active', '2026-01-01T00:00:00Z')", [uid, email, o]);
      for (const r of roles) await pg.query("insert into public.user_roles (user_id, role, granted_at) values ($1::uuid, $2, $3::timestamptz)", [uid, r, NOW]);
      return uid;
    };

    it("reset by email + phone works for a buyer and is refused for an account that holds a role", async () => {
      await buyer("plain@example.test", []);
      expect(await reset("plain@example.test", PH)).toMatchObject({ ok: true });
      await buyer("boss@example.test", ["support_admin"]);
      expect(await reset("boss@example.test", PH)).toEqual({ ok: false });
    });

    it("reset reports matched for the right pair even when it refuses, and not for a wrong phone", async () => {
      await buyer("m@example.test", []);
      expect(await reset("m@example.test", OTHER_PH)).toMatchObject({ ok: false, matched: false });
    });

    it("first MFA enrolment works inside 24 hours of the role grant and not after; a super_admin reset reopens it", async () => {
      const uid = await buyer("mfa@example.test", ["support_admin"]);
      const begin = (now: string) => attempt(pg, "select app_private.admin_mfa_begin($1::uuid, 'sealed', $2::timestamptz)", [uid, now]);
      expect(await begin(plus(23 * 3600_000))).toMatchObject({ ok: true });
      expect(await begin(plus(25 * 3600_000))).toMatchObject({ ok: false, error: { message: "FORBIDDEN" } });
      // a super_admin resets (needs an existing factor row, the pending one counts)
      const root = await buyer("root2@example.test", ["super_admin"]);
      await pg.query("select app_private.admin_mfa_reset($1::uuid, '{super_admin}'::text[], $2::uuid, 'Alasan uji yang cukup panjang', $3::timestamptz)", [root, uid, plus(26 * 3600_000)]);
      expect(await begin(plus(27 * 3600_000))).toMatchObject({ ok: true });
    });

    it("an account without a role cannot start enrolment", async () => {
      const uid = await buyer("norole@example.test", []);
      expect(await attempt(pg, "select app_private.admin_mfa_begin($1::uuid, 'sealed', $2::timestamptz)", [uid, NOW])).toMatchObject({ ok: false, error: { message: "FORBIDDEN" } });
    });
  });

  describe("C: khatam data is in the user's export", () => {
    it("lists targets and ticked slots, and an empty list for a user without a target", async () => {
      const empty = await createUser(pg);
      const e0 = (await rows<{ r: any }>(pg, "select app_private.export_user_data($1::uuid, $2::timestamptz) as r", [empty, NOW]))[0]!.r;
      expect(e0.khatam_targets).toEqual([]);
      expect(e0.khatam_reads).toEqual([]);

      const uid = await createUser(pg);
      const T1 = "2026-11-17T05:00:00Z";
      await pg.query("select app_private.create_khatam($1::uuid, $2::timestamptz, 2)", [uid, T1]);
      await pg.query("select app_private.set_khatam_slot($1::uuid, $2::timestamptz, 1, 'subuh', true)", [uid, T1]);
      await pg.query("select app_private.set_khatam_slot($1::uuid, $2::timestamptz, 1, 'dzuhur', true)", [uid, T1]);
      const x = (await rows<{ r: any }>(pg, "select app_private.export_user_data($1::uuid, $2::timestamptz) as r", [uid, NOW]))[0]!.r;
      expect(x.khatam_targets).toHaveLength(1);
      expect(x.khatam_targets[0]).toMatchObject({ khatam_count: 2, timezone: "Asia/Jakarta", adjustment: 0, ended_at: null });
      expect(x.khatam_reads.map((r: any) => `${r.day}:${r.prayer}:${r.pages}`)).toEqual(["1:subuh:8", "1:dzuhur:8"]);
      expect(x.khatam_reads[0].target_id).toBe(x.khatam_targets[0].id);
    });

    it("does not leak another user's khatam data", async () => {
      const a = await createUser(pg);
      const b = await createUser(pg);
      await pg.query("select app_private.create_khatam($1::uuid, $2::timestamptz, 3)", [a, "2026-11-17T05:00:00Z"]);
      const x = (await rows<{ r: any }>(pg, "select app_private.export_user_data($1::uuid, $2::timestamptz) as r", [b, NOW]))[0]!.r;
      expect(x.khatam_targets).toEqual([]);
    });
  });

  describe("C: the 517 EQuran regions are in the regions table", () => {
    it("loads 517 regions with a valid zone next to the 3 demo regions, and the demo ones stay", async () => {
      const n = await rows<{ n: number }>(pg, "select count(*)::int as n from public.regions where provider_region_code like '%::%'");
      expect(n[0]!.n).toBe(517);
      const demo = await rows<{ c: string }>(pg, "select provider_region_code as c from public.regions where provider_region_code like 'DEMO-%' order by 1");
      expect(demo.map((d) => d.c)).toEqual(["DEMO-DJJ", "DEMO-JKT", "DEMO-MKS"]);
      const bad = await rows(pg, "select 1 from public.regions where provider_region_code like '%::%' and (province_name = '' or city_name = '' or not is_supported)");
      expect(bad).toHaveLength(0);
    });

    it("uses the same id the prayer provider uses, with the province's zone", async () => {
      const r = await rows<any>(pg, "select province_name, city_name, timezone from public.regions where provider_region_code = 'DKI Jakarta::Kota Jakarta'");
      expect(r).toEqual([{ province_name: "DKI Jakarta", city_name: "Kota Jakarta", timezone: "Asia/Jakarta" }]);
    });

    it("is idempotent: running the migration again adds nothing and keeps changed rows", async () => {
      await pg.query("update public.regions set is_supported = false where provider_region_code = 'DKI Jakarta::Kota Jakarta'");
      await pg.exec(readFileSync(REGIONS_OUT, "utf8"));
      expect((await rows<{ n: number }>(pg, "select count(*)::int as n from public.regions where provider_region_code like '%::%'"))[0]!.n).toBe(517);
      expect((await rows<any>(pg, "select is_supported from public.regions where provider_region_code = 'DKI Jakarta::Kota Jakarta'"))[0]).toEqual({ is_supported: false });
    });

    it("the migration file is what the generator makes from content/regions/*.json", () => {
      expect(readFileSync(REGIONS_OUT, "utf8")).toBe(buildMigration());
    });
  });
});
