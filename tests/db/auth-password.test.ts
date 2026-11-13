import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, attempt, createTestDb, rows } from "./harness";

const NOW = "2026-11-12T03:00:00Z";
const PHONE_HASH = "a".repeat(64);
const PW_HASH = "$scrypt$ln=15,r=8,p=3$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g";
const TOKEN_A = "t".repeat(64);

describe("X4 schema: email + password, activation, admin reset links", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });
  afterAll(async () => pg.close());

  const order = async (email: string, opts: { phone?: string | null; verified?: string | null; payment?: string; blocked?: boolean } = {}) => {
    const id = (
      await rows<{ id: string }>(
        pg,
        `insert into public.purchase_orders (scalev_order_id, customer_email_normalized, payment_status, verified_via, customer_phone_hash, activation_blocked)
         values ($1, $2, $3, $4, $5, $6) returning id::text`,
        [
          `DB-${email}`,
          email,
          opts.payment ?? "paid",
          opts.verified === undefined ? "scalev_api" : opts.verified,
          opts.phone === undefined ? PHONE_HASH : opts.phone,
          opts.blocked ?? false,
        ],
      )
    )[0]!.id;
    await pg.query(
      "insert into public.access_entitlements (email_normalized, status, purchase_order_id, starts_at) values ($1, 'active', $2::uuid, '2026-01-01T00:00:00Z')",
      [email, id],
    );
  };
  const activate = async (email: string, phone: string | null = PHONE_HASH, hash: string | null = PW_HASH) =>
    (
      await rows<{ r: { ok: boolean; user_id?: string } }>(
        pg,
        "select app_private.activate_account($1, $2, $3, 'iphash', $4::timestamptz) as r",
        [email, phone, hash, NOW],
      )
    )[0]!.r;

  describe("OTP is gone", () => {
    it("has no login_otps table and no otp or provision_user function", async () => {
      expect(await rows(pg, "select 1 from pg_tables where schemaname = 'public' and tablename = 'login_otps'")).toHaveLength(0);
      expect(
        await rows(pg, "select 1 from pg_proc where proname in ('otp_issue', 'otp_verify', 'provision_user')"),
      ).toHaveLength(0);
    });
  });

  describe("tables are closed to the browser roles (SEC-03)", () => {
    it.each(["auth_credentials", "auth_tokens", "auth_events"])("%s: no select, insert, update or delete", async (table) => {
      for (const role of ["authenticated", "anon"] as const) {
        const uid = role === "authenticated" ? "00000000-0000-4000-8000-000000000001" : null;
        for (const sql of [
          `select * from public.${table}`,
          `insert into public.${table} default values`,
          `update public.${table} set user_id = user_id`,
          `delete from public.${table}`,
        ]) {
          const r = await as(pg, role, uid, () => attempt(pg, sql));
          expect(r, `${role}: ${sql}`).toMatchObject({ ok: false, error: { code: "42501" } });
        }
      }
    });

    it("the browser role cannot call the account functions", async () => {
      const calls = [
        "select app_private.activate_account('a@b.test', 'h', 'x', 'ip', now())",
        "select app_private.reset_password_self('a@b.test', 'h', 'x', 'ip', now())",
        "select app_private.password_token_consume('t', 'x', 'ip', now())",
        "select app_private.credential_for_login('a@b.test')",
      ];
      for (const sql of calls) {
        const r = await as(pg, "authenticated", "00000000-0000-4000-8000-000000000001", () => attempt(pg, sql));
        expect(r, sql).toMatchObject({ ok: false, error: { code: "42501" } });
      }
    });

    it("the backend role has no direct write access to auth.users (only the activation function creates accounts)", async () => {
      const r = await as(pg, "service_role", null, () =>
        attempt(pg, "insert into auth.users (email) values ('direct@ngajigaes.test')"),
      );
      expect(r).toMatchObject({ ok: false, error: { code: "42501" } });
    });
  });

  describe("constraints", () => {
    it("a column that is not a PHC hash is refused, so a plain password cannot be stored", async () => {
      const uid = (await rows<{ id: string }>(pg, "insert into auth.users (email) values ('c1@ngajigaes.test') returning id::text"))[0]!.id;
      for (const bad of ["plain-password-123", "short", "", "$x$"]) {
        const r = await attempt(pg, "insert into public.auth_credentials (user_id, password_hash, password_changed_at) values ($1::uuid, $2, now())", [uid, bad]);
        expect(r.ok, bad).toBe(false);
      }
      expect((await attempt(pg, "insert into public.auth_credentials (user_id, password_hash, password_changed_at) values ($1::uuid, $2, now())", [uid, PW_HASH])).ok).toBe(true);
    });

    it("staff_comp has no order and a lifetime entitlement keeps its order; other types are refused", async () => {
      await order("c2@ngajigaes.test");
      const orderId = (await rows<{ id: string }>(pg, "select id::text from public.purchase_orders where customer_email_normalized = 'c2@ngajigaes.test'"))[0]!.id;
      const staff = (type: string, withOrder: boolean) =>
        attempt(pg, "insert into public.access_entitlements (email_normalized, entitlement_type, status, purchase_order_id) values ('c2s@ngajigaes.test', $1, 'active', $2::uuid)", [type, withOrder ? orderId : null]);
      expect((await staff("staff_comp", false)).ok).toBe(true);
      expect((await staff("staff_comp", true)).ok).toBe(false);
      expect((await staff("timed", false)).ok).toBe(false);
    });

    it("an admin reset token has only the reset purpose", async () => {
      const uid = (await rows<{ id: string }>(pg, "insert into auth.users (email) values ('c3@ngajigaes.test') returning id::text"))[0]!.id;
      const r = await attempt(pg, "insert into public.auth_tokens (token_hash, user_id, purpose, created_at, expires_at) values ('h', $1::uuid, 'setup', now(), now())", [uid]);
      expect(r.ok).toBe(false);
    });

    it("auth_events accept only the known kinds", async () => {
      expect((await attempt(pg, "insert into public.auth_events (kind, at) values ('login', now())")).ok).toBe(false);
      expect((await attempt(pg, "insert into public.auth_events (kind, at) values ('activated', now())")).ok).toBe(true);
    });
  });

  describe("activate_account", () => {
    it("creates user, profile and credentials and links the entitlement in one go", async () => {
      await order("d1@ngajigaes.test");
      const r = await activate("d1@ngajigaes.test");
      expect(r.ok).toBe(true);
      const uid = r.user_id!;
      expect(await rows(pg, "select 1 from auth.users where id = $1::uuid and email = 'd1@ngajigaes.test'", [uid])).toHaveLength(1);
      expect(await rows(pg, "select 1 from public.profiles where user_id = $1::uuid", [uid])).toHaveLength(1);
      expect((await rows<{ password_hash: string }>(pg, "select password_hash from public.auth_credentials where user_id = $1::uuid", [uid]))[0]!.password_hash).toBe(PW_HASH);
      expect(await rows(pg, "select 1 from public.access_entitlements where user_id = $1::uuid and status = 'active'", [uid])).toHaveLength(1);
      expect(await rows(pg, "select 1 from public.auth_events where user_id = $1::uuid and kind = 'activated' and ip_hash = 'iphash'", [uid])).toHaveLength(1);
    });

    it("returns {ok:false} and writes nothing for every kind of mismatch", async () => {
      await order("d2@ngajigaes.test");
      await order("d2-nophone@ngajigaes.test", { phone: null });
      await order("d2-unpaid@ngajigaes.test", { payment: "unpaid" });
      await order("d2-manual@ngajigaes.test", { verified: "admin_manual" });
      await order("d2-unverified@ngajigaes.test", { verified: null });
      await order("d2-blocked@ngajigaes.test", { blocked: true });
      const before = Number((await rows<{ n: string }>(pg, "select count(*) as n from auth.users"))[0]!.n);
      const results = [
        await activate("d2@ngajigaes.test", "b".repeat(64)),
        await activate("d2@ngajigaes.test", null),
        await activate("d2@ngajigaes.test", PHONE_HASH, null),
        await activate("nobody@ngajigaes.test"),
        await activate("d2-nophone@ngajigaes.test"),
        await activate("d2-unpaid@ngajigaes.test"),
        await activate("d2-manual@ngajigaes.test"),
        await activate("d2-unverified@ngajigaes.test"),
        await activate("d2-blocked@ngajigaes.test"),
      ];
      for (const r of results) expect(r).toEqual({ ok: false });
      expect(Number((await rows<{ n: string }>(pg, "select count(*) as n from auth.users"))[0]!.n)).toBe(before);
    });

    it("refuses an entitlement that is not active or not yet started or already ended", async () => {
      for (const [email, set] of [
        ["d3-susp@ngajigaes.test", "status = 'suspended'"],
        ["d3-future@ngajigaes.test", "starts_at = '2030-01-01'"],
        ["d3-ended@ngajigaes.test", "expires_at = '2026-06-01'"],
      ] as const) {
        await order(email);
        await pg.query(`update public.access_entitlements set ${set} where email_normalized = $1`, [email]);
        expect(await activate(email), email).toEqual({ ok: false });
      }
    });

    it("a second call for the same email finds the account and fails; there is one account", async () => {
      await order("d4@ngajigaes.test");
      expect((await activate("d4@ngajigaes.test")).ok).toBe(true);
      expect(await activate("d4@ngajigaes.test")).toEqual({ ok: false });
      expect(await rows(pg, "select 1 from auth.users where email = 'd4@ngajigaes.test'")).toHaveLength(1);
    });

    it("does not link an entitlement bought with another phone to the new account", async () => {
      await order("d5@ngajigaes.test");
      await pg.query("insert into public.purchase_orders (scalev_order_id, customer_email_normalized, payment_status, verified_via, customer_phone_hash) values ('DB-d5-other', 'd5@ngajigaes.test', 'paid', 'scalev_api', $1)", ["c".repeat(64)]);
      const other = (await rows<{ id: string }>(pg, "select id::text from public.purchase_orders where scalev_order_id = 'DB-d5-other'"))[0]!.id;
      await pg.query("insert into public.access_entitlements (email_normalized, status, purchase_order_id, starts_at) values ('d5@ngajigaes.test', 'active', $1::uuid, '2026-01-01T00:00:00Z')", [other]);
      const r = await activate("d5@ngajigaes.test");
      expect(r.ok).toBe(true);
      const linked = await rows<{ user_id: string | null }>(pg, "select user_id from public.access_entitlements where email_normalized = 'd5@ngajigaes.test' order by purchase_order_id = $1::uuid", [other]);
      expect(linked.filter((x) => x.user_id !== null)).toHaveLength(1);
    });
  });

  describe("admin reset tokens", () => {
    const user = async (email: string) =>
      (await rows<{ id: string }>(pg, "insert into auth.users (email) values ($1) returning id::text", [email]))[0]!.id;
    const issue = async (actor: string | null, target: string, hash: string, reason: string, now = NOW, ttl: number | null = null) =>
      attempt(pg, "select app_private.password_token_issue($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::int) as r", [actor, target, hash, reason, now, ttl]);
    const consume = async (hash: string, now = NOW) =>
      (await rows<{ r: { ok: boolean; user_id?: string } }>(pg, "select app_private.password_token_consume($1, $2, 'ip', $3::timestamptz) as r", [hash, PW_HASH, now]))[0]!.r;

    it("works once, then not again", async () => {
      const uid = await user("t1@ngajigaes.test");
      expect((await issue(null, uid, "1".repeat(64), "alasan uji")).ok).toBe(true);
      expect(await consume("1".repeat(64))).toMatchObject({ ok: true, user_id: uid });
      expect(await consume("1".repeat(64))).toEqual({ ok: false });
    });

    it("default lifetime is the reset_token_minutes setting (60) and it expires on the second", async () => {
      const uid = await user("t2@ngajigaes.test");
      const r = await issue(null, uid, "2".repeat(64), "alasan uji");
      expect(r.ok && (r.rows[0] as { r: { expires_at: string } }).r.expires_at).toBe("2026-11-12T04:00:00.000Z");
      expect(await consume("2".repeat(64), "2026-11-12T04:00:00Z")).toEqual({ ok: false });
      await issue(null, uid, "3".repeat(64), "alasan uji");
      expect((await consume("3".repeat(64), "2026-11-12T03:59:59Z")).ok).toBe(true);
    });

    it("the lifetime follows the setting when an owner changes it", async () => {
      const uid = await user("t2b@ngajigaes.test");
      await pg.query("update public.app_settings set value = '15'::jsonb where key = 'reset_token_minutes'");
      const r = await issue(null, uid, "9".repeat(64), "alasan uji");
      expect(r.ok && (r.rows[0] as { r: { expires_at: string } }).r.expires_at).toBe("2026-11-12T03:15:00.000Z");
      await pg.query("update public.app_settings set value = '60'::jsonb where key = 'reset_token_minutes'");
    });

    it("a new token revokes the open ones of the same account only", async () => {
      const a = await user("t3a@ngajigaes.test");
      const b = await user("t3b@ngajigaes.test");
      await issue(null, a, "4".repeat(64), "alasan uji");
      await issue(null, b, "5".repeat(64), "alasan uji");
      await issue(null, a, "6".repeat(64), "alasan uji");
      expect(await consume("4".repeat(64))).toEqual({ ok: false });
      expect((await consume("5".repeat(64))).ok).toBe(true);
      expect((await consume("6".repeat(64))).ok).toBe(true);
    });

    it("needs a reason and a real account and writes the audit log", async () => {
      const uid = await user("t4@ngajigaes.test");
      expect((await issue(null, uid, "7".repeat(64), "  ")).ok).toBe(false);
      expect((await issue(null, uid, "7".repeat(64), "ab")).ok).toBe(false);
      expect((await issue(null, "00000000-0000-4000-8000-0000000000ff", "7".repeat(64), "alasan uji")).ok).toBe(false);
      expect((await issue(null, uid, "short", "alasan uji")).ok).toBe(false);
      expect((await issue(null, uid, "7".repeat(64), "Pembeli lupa password")).ok).toBe(true);
      const log = await rows<{ action: string; reason: string }>(pg, "select action, reason from public.admin_audit_logs where entity_id = $1", [uid]);
      expect(log).toEqual([{ action: "password_reset_link_created", reason: "Pembeli lupa password" }]);
    });

    it("consuming revokes every device of the account", async () => {
      const uid = await user("t5@ngajigaes.test");
      await pg.query("insert into public.user_devices (user_id, label) values ($1::uuid, 'HP')", [uid]);
      await issue(null, uid, "8".repeat(64), "alasan uji");
      await consume("8".repeat(64));
      expect(await rows(pg, "select 1 from public.user_devices where user_id = $1::uuid and revoked_at is null", [uid])).toHaveLength(0);
    });
  });

  describe("account deletion", () => {
    it("removes the credentials and the phone proof, and keeps the event without a user", async () => {
      await order("x1@ngajigaes.test");
      const uid = (await activate("x1@ngajigaes.test")).user_id!;
      await pg.query("select app_private.delete_account($1::uuid, $2::timestamptz, $3)", [uid, NOW, `deleted:${"f".repeat(40)}`]);
      expect(await rows(pg, "select 1 from public.auth_credentials where user_id = $1::uuid", [uid])).toHaveLength(0);
      expect(
        await rows(pg, "select 1 from public.purchase_orders where scalev_order_id = 'DB-x1@ngajigaes.test' and customer_phone_hash is not null"),
      ).toHaveLength(0);
      expect(await rows(pg, "select 1 from public.auth_events where kind = 'activated' and user_id is null")).not.toHaveLength(0);
    });
  });
});
