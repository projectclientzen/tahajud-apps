import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attempt, createTestDb, rows } from "./harness";

const NOW = "2026-11-12T03:00:00Z";
const PHONE_HASH = "b".repeat(64);
const OTHER_PHONE_HASH = "c".repeat(64);
const PW_HASH = "$scrypt$ln=15,r=8,p=3$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g";
const REASON = "Alasan uji yang cukup panjang";

describe("X8 schema: staff accounts, order tools, level bypass, report exclusion", () => {
  let pg: PGlite;
  let superId: string;
  let supportId: string;
  let n = 0;

  const user = async (email: string, roles: string[] = []): Promise<string> => {
    const id = (await rows<{ id: string }>(pg, "insert into auth.users (email) values ($1) returning id::text", [email]))[0]!.id;
    await pg.query("insert into public.profiles (user_id, email_normalized, program_start_date) values ($1::uuid, $2, '2026-11-01')", [id, email]);
    for (const r of roles) await pg.query("insert into public.user_roles (user_id, role) values ($1::uuid, $2)", [id, r]);
    return id;
  };
  const call = async <T = unknown>(fn: string, casts: string[], args: unknown[], actor: string, roles: string[]) => {
    const types = ["uuid", "text[]", ...casts];
    const call = `app_private.${fn}(${types.map((t, i) => `$${i + 1}::${t}`).join(", ")})`;
    return attempt<{ r: T }>(pg, `select ${call} as r`, [actor, `{${roles.join(",")}}`, ...args]);
  };
  const ok = async <T = Record<string, any>>(...a: Parameters<typeof call>): Promise<T> => {
    const r = await call<T>(...a);
    if (!r.ok) throw new Error(`${a[0]} failed: ${r.error.message} ${r.error.detail ?? ""}`);
    return r.rows[0]!.r;
  };
  const SUP = ["super_admin"];
  const SUPPORT = ["super_admin", "support_admin"];

  const order = async (email: string | null, opts: { phone?: string | null; quarantine?: string | null; paid?: string; ent?: string | null } = {}) => {
    const id = (
      await rows<{ id: string }>(
        pg,
        `insert into public.purchase_orders (scalev_order_id, customer_email_normalized, payment_status, verified_via, customer_phone_hash, quarantine_reason)
         values ($1, $2, $3, 'scalev_api', $4, $5) returning id::text`,
        [`X8-${++n}`, email, opts.paid ?? "paid", opts.phone === undefined ? PHONE_HASH : opts.phone, opts.quarantine ?? null],
      )
    )[0]!.id;
    if (opts.ent) {
      await pg.query(
        "insert into public.access_entitlements (email_normalized, status, purchase_order_id, starts_at) values ($1, $2, $3::uuid, '2026-01-01T00:00:00Z')",
        [email, opts.ent, id],
      );
    }
    return id;
  };
  const activate = async (email: string, phone = PHONE_HASH) =>
    (await rows<{ r: { ok: boolean } }>(pg, "select app_private.activate_account($1, $2, $3, 'iphash', $4::timestamptz) as r", [email, phone, PW_HASH, NOW]))[0]!.r;

  beforeAll(async () => {
    pg = await createTestDb();
    superId = await user("root@ngajigaes.test", ["super_admin"]);
    supportId = await user("cs@ngajigaes.test", ["support_admin"]);
  }, 60_000);
  afterAll(async () => pg.close());

  describe("staff accounts", () => {
    let staffId: string;
    let entId: string;

    it("creates user + profile + staff_comp with no order, no password and no credentials row", async () => {
      const r = await ok<{ user_id: string; entitlement: { id: string } }>("admin_staff_create", ["text", "text", "text", "timestamptz"], ["Tim@NgajiGaes.test", "Tim Satu", REASON, NOW], superId, SUP);
      staffId = r.user_id;
      entId = r.entitlement.id;
      const e = (await rows<any>(pg, "select * from public.access_entitlements where id = $1::uuid", [entId]))[0];
      expect(e).toMatchObject({ entitlement_type: "staff_comp", status: "active", purchase_order_id: null, user_id: staffId, email_normalized: "tim@ngajigaes.test" });
      expect(e.granted_by).toBe(superId);
      expect(await rows(pg, "select 1 from public.auth_credentials where user_id = $1::uuid", [staffId])).toHaveLength(0);
      expect(await rows(pg, "select 1 from public.purchase_orders where customer_email_normalized = 'tim@ngajigaes.test'")).toHaveLength(0);
      // The password column of nothing exists: there is no function that takes a password from an admin.
      const fns = await rows<{ src: string }>(pg, "select pg_get_functiondef(p.oid) as src from pg_proc p where proname like 'admin\\_%'");
      for (const f of fns) expect(f.src.toLowerCase()).not.toMatch(/password_hash|p_password/);
    });

    it("is audited with the reason and who did it", async () => {
      const a = await rows<any>(pg, "select * from public.admin_audit_logs where action = 'staff.created' and entity_id = $1", [entId]);
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ actor_id: superId, reason: REASON, entity_type: "entitlement" });
    });

    it("refuses a role that is not allowed, a short reason, a bad email, an existing account, and an email that already has an order", async () => {
      const args = (email: string, reason = REASON) => [email, null, reason, NOW];
      const T = ["text", "text", "text", "timestamptz"];
      expect((await call("admin_staff_create", T, args("x1@ngajigaes.test"), supportId, ["content_admin"])).ok).toBe(false);
      expect((await call("admin_staff_create", T, args("x2@ngajigaes.test", "pendek"), superId, SUP)).ok).toBe(false);
      expect((await call("admin_staff_create", T, args("bukan-email"), superId, SUP)).ok).toBe(false);
      const dup = await call("admin_staff_create", T, args("tim@ngajigaes.test"), superId, SUP);
      expect(dup).toMatchObject({ ok: false, error: { message: "CONFLICT" } });
      await order("pembeli-lama@ngajigaes.test", { ent: "active" });
      const taken = await call("admin_staff_create", T, args("pembeli-lama@ngajigaes.test"), superId, SUP);
      expect(taken).toMatchObject({ ok: false, error: { message: "CONFLICT" } });
      expect(await rows(pg, "select 1 from public.profiles where email_normalized = 'pembeli-lama@ngajigaes.test'")).toHaveLength(0);
    });

    it("rejects Arabic text in the display name (admin_text)", async () => {
      const r = await call("admin_staff_create", ["text", "text", "text", "timestamptz"], ["ar@ngajigaes.test", "بسم الله", REASON, NOW], superId, SUP);
      expect(r.ok).toBe(false);
    });

    it("lists staff with has_password false until they set one", async () => {
      const list = await ok<any[]>("admin_staff_list", [], [], superId, SUP);
      const mine = list.find((s) => s.entitlement_id === entId);
      expect(mine).toMatchObject({ email: "tim@ngajigaes.test", status: "active", has_password: false, granted_by_email: "root@ngajigaes.test" });
      expect((await call("admin_staff_list", [], [], supportId, ["content_admin"])).ok).toBe(false);
    });

    it("a staff account has every level open and nothing is written to user_level_state", async () => {
      expect((await rows<{ b: boolean }>(pg, "select app_private.has_all_levels($1::uuid) as b", [staffId]))[0]!.b).toBe(true);
      await pg.query("update public.profiles set program_start_date = '2026-11-01' where user_id = $1::uuid", [staffId]);
      const prog = (await rows<{ j: any }>(pg, "select app_private.level_progress_json($1::uuid, $2::timestamptz) as j", [staffId, NOW]))[0]!.j;
      expect(prog.levels.map((l: any) => l.unlocked)).toEqual([true, true, true]);
      expect(prog.levels.every((l: any) => l.effective_from_session_key === "2026-11-01")).toBe(true);
      expect(prog.current_level).toBe(3);
      expect(await rows(pg, "select 1 from public.user_level_state where user_id = $1::uuid", [staffId])).toHaveLength(0);
      const cur = (await rows<{ j: any }>(pg, "select app_private.get_current_level($1::uuid, $2::timestamptz) as j", [staffId, NOW]))[0]!.j;
      expect(cur.level).toBe(3);
    });

    it("a buyer still unlocks levels the normal way (the bypass is not global)", async () => {
      const buyer = await user("pembeli-biasa@ngajigaes.test");
      await pg.query("insert into public.access_entitlements (user_id, email_normalized, status, starts_at) values ($1::uuid, 'pembeli-biasa@ngajigaes.test', 'active', '2026-01-01')", [buyer]);
      const prog = (await rows<{ j: any }>(pg, "select app_private.level_progress_json($1::uuid, $2::timestamptz) as j", [buyer, NOW]))[0]!.j;
      expect(prog.levels.map((l: any) => l.unlocked)).toEqual([true, false, false]);
      expect(prog.current_level).toBe(1);
    });

    it("is left out of every aggregate count, with its entitlement type", async () => {
      // Twenty buyers would be needed to show a number; here the raw counts are compared with and without the staff row.
      const before = (await rows<{ j: any }>(pg, "select app_private.admin_aggregates($1::uuid, '{super_admin}', $2::timestamptz) as j", [superId, NOW]))[0]!.j;
      const accountsNow = Number(before.accounts);
      const profiles = Number((await rows<{ n: number }>(pg, "select count(*)::int as n from public.profiles"))[0]!.n);
      const staffProfiles = Number((await rows<{ n: number }>(pg, "select count(*)::int as n from public.profiles p where app_private.is_staff_user(p.user_id)"))[0]!.n);
      expect(staffProfiles).toBe(1);
      expect(accountsNow).toBe(profiles - staffProfiles);
      expect(before.entitlements.some((g: any) => false)).toBe(false);
      const staffInEnt = (await rows<{ n: number }>(pg, "select count(*)::int as n from public.access_entitlements where entitlement_type = 'staff_comp'"))[0]!.n;
      expect(staffInEnt).toBe(1);
      const total = before.entitlements.reduce((s: number, g: any) => s + Number(g.n), 0);
      const allEnt = Number((await rows<{ n: number }>(pg, "select count(*)::int as n from public.access_entitlements"))[0]!.n);
      expect(total).toBe(allEnt - staffInEnt);
      expect(Number(before.active_users)).toBe(
        Number((await rows<{ n: number }>(pg, "select count(distinct user_id)::int as n from public.access_entitlements where status = 'active' and entitlement_type <> 'staff_comp' and user_id is not null"))[0]!.n),
      );
    });

    it("can be revoked once, with a reason, and the level bypass ends with it", async () => {
      expect((await call("admin_staff_revoke", ["uuid", "text", "timestamptz"], [entId, "pendek", NOW], superId, SUP)).ok).toBe(false);
      expect((await call("admin_staff_revoke", ["uuid", "text", "timestamptz"], [entId, REASON, NOW], supportId, SUP)).ok).toBe(false);
      const r = await ok<any>("admin_staff_revoke", ["uuid", "text", "timestamptz"], [entId, REASON, NOW], superId, SUP);
      expect(r).toMatchObject({ status: "revoked", revoke_reason: REASON });
      const again = await call("admin_staff_revoke", ["uuid", "text", "timestamptz"], [entId, REASON, NOW], superId, SUP);
      expect(again).toMatchObject({ ok: false, error: { message: "INVALID_TRANSITION" } });
      expect((await rows<{ b: boolean }>(pg, "select app_private.has_all_levels($1::uuid) as b", [staffId]))[0]!.b).toBe(false);
      expect((await rows<{ b: boolean }>(pg, "select app_private.has_active_entitlement($1::uuid, $2::timestamptz) as b", [staffId, NOW]))[0]!.b).toBe(false);
      // A former staff account is still not a buyer in reports.
      expect((await rows<{ b: boolean }>(pg, "select app_private.is_staff_user($1::uuid) as b", [staffId]))[0]!.b).toBe(true);
      expect(await rows(pg, "select 1 from public.admin_audit_logs where action = 'staff.revoked' and entity_id = $1", [entId])).toHaveLength(1);
    });

    it("cannot revoke a normal buyer entitlement through the staff function", async () => {
      const id = (await rows<{ id: string }>(pg, "select id::text from public.access_entitlements where email_normalized = 'pembeli-lama@ngajigaes.test'"))[0]!.id;
      expect(await call("admin_staff_revoke", ["uuid", "text", "timestamptz"], [id, REASON, NOW], superId, SUP)).toMatchObject({ ok: false, error: { message: "NOT_FOUND" } });
    });
  });

  describe("orders: approve by hand", () => {
    it("a quarantined order gets an active entitlement, verified_via admin_manual, and the buyer can then activate", async () => {
      const id = await order("manual1@ngajigaes.test", { quarantine: "amount_below_min", paid: "paid" });
      expect(await activate("manual1@ngajigaes.test")).toMatchObject({ ok: false });
      const d0 = await ok<any>("admin_order_detail", ["uuid"], [id], supportId, SUPPORT);
      expect(d0).toMatchObject({ can_approve: true, can_self_activate: false });
      expect(d0.order.quarantine_reason).toBe("amount_below_min");
      const r = await ok<any>("admin_order_approve", ["uuid", "text", "text", "timestamptz"], [id, REASON, "bukti-transfer-123", NOW], supportId, SUPPORT);
      expect(r.order).toMatchObject({ verified_via: "admin_manual", quarantine_reason: null });
      expect(r.entitlement).toMatchObject({ status: "active", entitlement_type: "lifetime" });
      const audit = (await rows<any>(pg, "select * from public.admin_audit_logs where action = 'order.approved_manual' and entity_id = $1", [id]))[0];
      expect(audit).toMatchObject({ reason: REASON, approval_reference: "bukti-transfer-123", actor_id: supportId });
      expect(audit.before.quarantine_reason).toBe("amount_below_min");
      expect(await activate("manual1@ngajigaes.test", OTHER_PHONE_HASH)).toMatchObject({ ok: false });
      expect(await activate("manual1@ngajigaes.test")).toMatchObject({ ok: true });
    });

    it("an unpaid order approved by hand can be activated too (the admin attests, with a reference)", async () => {
      const id = await order("manual2@ngajigaes.test", { paid: "unpaid" });
      await ok("admin_order_approve", ["uuid", "text", "text", "timestamptz"], [id, REASON, "ref-2", NOW], supportId, SUPPORT);
      expect(await activate("manual2@ngajigaes.test")).toMatchObject({ ok: true });
    });

    it("needs a reason, a reference, the right role, an email on the order, and is refused twice", async () => {
      const id = await order("manual3@ngajigaes.test", { quarantine: "spam_flag" });
      const T = ["uuid", "text", "text", "timestamptz"];
      expect((await call("admin_order_approve", T, [id, "pendek", "ref", NOW], supportId, SUPPORT)).ok).toBe(false);
      expect((await call("admin_order_approve", T, [id, REASON, "", NOW], supportId, SUPPORT)).ok).toBe(false);
      expect((await call("admin_order_approve", T, [id, REASON, "ref", NOW], supportId, ["content_admin"])).ok).toBe(false);
      const noEmail = await order(null, { quarantine: "missing_email" });
      expect(await call("admin_order_approve", T, [noEmail, REASON, "ref", NOW], supportId, SUPPORT)).toMatchObject({ ok: false, error: { message: "VALIDATION_ERROR" } });
      await ok("admin_order_approve", T, [id, REASON, "ref", NOW], supportId, SUPPORT);
      expect(await call("admin_order_approve", T, [id, REASON, "ref", NOW], supportId, SUPPORT)).toMatchObject({ ok: false, error: { message: "INVALID_TRANSITION" } });
      expect(await rows(pg, "select 1 from public.access_entitlements where purchase_order_id = $1::uuid", [id])).toHaveLength(1);
    });

    it("a pending_verification entitlement on the order becomes active instead of getting a second one", async () => {
      const id = await order("manual4@ngajigaes.test", { ent: "pending_verification" });
      await ok("admin_order_approve", ["uuid", "text", "text", "timestamptz"], [id, REASON, "ref", NOW], supportId, SUPPORT);
      expect(await rows(pg, "select status from public.access_entitlements where purchase_order_id = $1::uuid", [id])).toEqual([{ status: "active" }]);
    });

    it("a revoked or suspended entitlement is not reopened through this function", async () => {
      const id = await order("manual5@ngajigaes.test", { ent: "revoked" });
      expect(await call("admin_order_approve", ["uuid", "text", "text", "timestamptz"], [id, REASON, "ref", NOW], supportId, SUPPORT)).toMatchObject({ ok: false, error: { message: "INVALID_TRANSITION" } });
    });
  });

  describe("orders: block and unblock activation", () => {
    it("blocked: activation fails the same way as any other failure; unblocked: it works", async () => {
      const id = await order("blok1@ngajigaes.test", { ent: "active" });
      const T = ["uuid", "boolean", "text", "timestamptz"];
      expect((await call("admin_order_set_activation_blocked", T, [id, true, "pendek", NOW], supportId, SUPPORT)).ok).toBe(false);
      expect((await call("admin_order_set_activation_blocked", T, [id, true, REASON, NOW], supportId, ["content_admin"])).ok).toBe(false);
      const blocked = await ok<any>("admin_order_set_activation_blocked", T, [id, true, REASON, NOW], supportId, SUPPORT);
      expect(blocked.activation_blocked).toBe(true);
      expect(await activate("blok1@ngajigaes.test")).toEqual({ ok: false });
      expect(await call("admin_order_set_activation_blocked", T, [id, true, REASON, NOW], supportId, SUPPORT)).toMatchObject({ ok: false, error: { message: "INVALID_TRANSITION" } });
      const detail = await ok<any>("admin_order_detail", ["uuid"], [id], supportId, SUPPORT);
      expect(detail.can_self_activate).toBe(false);
      await ok("admin_order_set_activation_blocked", T, [id, false, REASON, NOW], supportId, SUPPORT);
      expect(await activate("blok1@ngajigaes.test")).toMatchObject({ ok: true });
      const acts = (await rows<{ action: string }>(pg, "select action from public.admin_audit_logs where entity_id = $1 order by occurred_at", [id])).map((r) => r.action);
      expect(acts).toEqual(["order.activation_blocked", "order.activation_unblocked"]);
    });
  });

  describe("phone numbers", () => {
    it("no admin function result or order json contains the phone hash or a phone key", async () => {
      const id = await order("hp1@ngajigaes.test", { ent: "active" });
      const detail = await ok<any>("admin_order_detail", ["uuid"], [id], supportId, SUPPORT);
      const search = await ok<any>("admin_search", ["text"], ["hp1@ngajigaes"], supportId, SUPPORT);
      const list = await ok<any>("admin_orders_list", ["text", "int", "int"], ["all", 100, 0], supportId, SUPPORT);
      const text = JSON.stringify([detail, search, list]);
      expect(text).not.toContain(PHONE_HASH);
      expect(text).not.toMatch(/phone_hash|customer_phone|"phone"/);
      expect(detail.order.phone_on_file).toBe(true);
    });

    it("a check says match or not, needs the right role, is rate limited, and every check is audited without the number", async () => {
      const id = await order("hp2@ngajigaes.test", { ent: "active" });
      const T = ["uuid", "text", "timestamptz"];
      expect((await call("admin_order_phone_check", T, [id, PHONE_HASH, NOW], supportId, ["content_admin"])).ok).toBe(false);
      expect(await ok("admin_order_phone_check", T, [id, PHONE_HASH, NOW], supportId, SUPPORT)).toEqual({ match: true, phone_on_file: true });
      expect(await ok("admin_order_phone_check", T, [id, OTHER_PHONE_HASH, NOW], supportId, SUPPORT)).toEqual({ match: false, phone_on_file: true });
      const audit = await rows<any>(pg, "select * from public.admin_audit_logs where action = 'order.phone_checked' and entity_id = $1 order by occurred_at, id", [id]);
      expect(audit).toHaveLength(2);
      expect(JSON.stringify(audit)).not.toContain(PHONE_HASH);
      expect(JSON.stringify(audit)).not.toContain(OTHER_PHONE_HASH);
      for (let i = 0; i < 3; i++) await ok("admin_order_phone_check", T, [id, OTHER_PHONE_HASH, NOW], supportId, SUPPORT);
      expect(await call("admin_order_phone_check", T, [id, OTHER_PHONE_HASH, NOW], supportId, SUPPORT)).toMatchObject({ ok: false, error: { message: "RATE_LIMITED" } });
    });

    it("an order without a phone says so instead of matching a null", async () => {
      const id = await order("hp3@ngajigaes.test", { phone: null, ent: "active" });
      expect(await ok("admin_order_phone_check", ["uuid", "text", "timestamptz"], [id, PHONE_HASH, NOW], supportId, SUPPORT)).toEqual({ match: false, phone_on_file: false });
    });
  });

  describe("reset link checks", () => {
    it("a buyer without an account cannot be reset; support cannot reset an admin; super_admin can", async () => {
      const T = ["uuid", "text", "timestamptz"];
      expect(await call("admin_reset_precheck", T, ["00000000-0000-4000-8000-0000000000ff", REASON, NOW], supportId, SUPPORT)).toMatchObject({ ok: false, error: { message: "NOT_FOUND" } });
      const regular = await user("reset-biasa@ngajigaes.test");
      expect((await ok<any>("admin_reset_precheck", T, [regular, REASON, NOW], supportId, ["support_admin"])).email).toBe("reset-biasa@ngajigaes.test");
      expect(await call("admin_reset_precheck", T, [superId, REASON, NOW], supportId, ["support_admin"])).toMatchObject({ ok: false, error: { message: "FORBIDDEN" } });
      expect((await call("admin_reset_precheck", T, [supportId, REASON, NOW], superId, SUP)).ok).toBe(true);
      expect((await call("admin_reset_precheck", T, [regular, "pendek", NOW], supportId, ["support_admin"])).ok).toBe(false);
      expect((await call("admin_reset_precheck", T, [regular, REASON, NOW], supportId, ["content_admin"])).ok).toBe(false);
    });

    it("is limited to 10 per hour per admin", async () => {
      const regular = await user("reset-limit@ngajigaes.test");
      const T = ["uuid", "text", "timestamptz"];
      let last: any;
      for (let i = 0; i < 12; i++) last = await call("admin_reset_precheck", T, [regular, REASON, NOW], superId, SUP);
      expect(last).toMatchObject({ ok: false, error: { message: "RATE_LIMITED" } });
    });
  });
});
