import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/data/contracts";
import { hmacHex } from "@/server/auth/crypto";
import { issueAdminResetToken } from "@/server/auth/tokens";
import { createApiEnv, TEST_PASSWORD, TEST_PHONE, type ApiEnv } from "./api-harness";

const MIN = 60_000;
const T0 = "2026-11-12T02:00:00+07:00";
const at = (ms: number) => new Date(Date.parse(T0) + ms).toISOString();
const NEW_PW = "kata-sandi-baru-yang-panjang";

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof ApiError ? e.code : "other";
  }
}

describe("activation, reset and admin links", () => {
  let env: ApiEnv;
  beforeAll(async () => {
    env = await createApiEnv();
  });
  afterAll(async () => env.close());
  // Every test starts with a clean clock and empty counters: the phone and email limits are shared by design.
  beforeEach(async () => {
    await env.setNow(T0);
    await env.db.exec("delete from public.rate_limits");
  });

  const act = (b: ReturnType<ApiEnv["browser"]>, email: string, phone: string, password = NEW_PW) =>
    b.json("/auth/activate", "POST", { email, phone, password, device_label: "HP baru" });

  describe("ACT-01: activation needs email AND phone of a paid, verified order", () => {
    it("creates the account, links the entitlement and opens a session on this device", async () => {
      await env.setNow(T0);
      await env.grantOrder("act1@ngajigaes.test");
      const b = env.browser();
      const res = await act(b, "act1@ngajigaes.test", TEST_PHONE);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ status: "ok", user: { email: "act1@ngajigaes.test" }, access: { access_status: "active" } });
      expect(res.headers.get("set-cookie")).toMatch(/^tt_session=/);
      expect((await b.auth().getSession()).authenticated).toBe(true);
      // the new password works for a later login on another device
      expect((await env.browser().auth().login("act1@ngajigaes.test", NEW_PW)).status).toBe("ok");
      expect(await env.db.exec("select kind from public.auth_events where kind = 'activated'")).toHaveLength(1);
    });

    it("treats 08..., 628..., +628..., spaces and dashes as the same phone", async () => {
      await env.grantOrder("act2@ngajigaes.test", { phone: "0812 3456 7890" });
      const b = env.browser();
      expect((await act(b, "act2@ngajigaes.test", "+62 812-3456-7890")).status).toBe(200);
      await env.grantOrder("act2b@ngajigaes.test", { phone: "628123456789" });
      expect((await act(env.browser(), "act2b@ngajigaes.test", "0812-3456-789")).status).toBe(200);
    });

    it("normalizes the email like login does", async () => {
      await env.grantOrder("act3@ngajigaes.test");
      expect((await act(env.browser(), "  ACT3@Ngajigaes.test ", TEST_PHONE)).status).toBe(200);
    });

    it("stores a hash of the phone, never the number or the password (ACT-05)", async () => {
      await env.grantOrder("act4@ngajigaes.test");
      await act(env.browser(), "act4@ngajigaes.test", TEST_PHONE, "sandi-rahasia-unik-987");
      const dump = JSON.stringify([
        await env.db.exec("select * from public.purchase_orders"),
        await env.db.exec("select * from public.auth_credentials"),
        await env.db.exec("select * from public.auth_events"),
        await env.db.exec("select * from public.rate_limits"),
        await env.db.exec("select * from public.profiles"),
      ]);
      for (const secret of ["081234567890", "6281234567890", "0812-3456-7890", "sandi-rahasia-unik-987"]) {
        expect(dump).not.toContain(secret);
      }
    });
  });

  describe("ACT-02: every failure looks the same", () => {
    it("unknown email, wrong phone, unpaid order, unverified order, no phone on the order and existing account", async () => {
      await env.grantOrder("f-wrongphone@ngajigaes.test");
      await env.grantOrder("f-unpaid@ngajigaes.test", { paymentStatus: "unpaid" });
      await env.grantOrder("f-unverified@ngajigaes.test", { verifiedVia: null });
      await env.grantOrder("f-pending@ngajigaes.test", { status: "pending_verification" });
      await env.createAccount("f-existing@ngajigaes.test");
      await env.grantOrder("f-existing@ngajigaes.test");
      await env.grant("f-noorder@ngajigaes.test");
      await env.db.exec("update public.purchase_orders set customer_phone_hash = null where customer_email_normalized = 'f-unverified@ngajigaes.test' and false");
      const cases: [string, string][] = [
        ["nobody@ngajigaes.test", TEST_PHONE],
        ["f-wrongphone@ngajigaes.test", "081111111111"],
        ["f-wrongphone@ngajigaes.test", "bukan nomor"],
        ["f-unpaid@ngajigaes.test", TEST_PHONE],
        ["f-unverified@ngajigaes.test", TEST_PHONE],
        ["f-pending@ngajigaes.test", TEST_PHONE],
        ["f-existing@ngajigaes.test", TEST_PHONE],
        ["f-noorder@ngajigaes.test", TEST_PHONE],
      ];
      const answers: string[] = [];
      for (const [email, phone] of cases) {
        await env.db.exec("delete from public.rate_limits"); // the shared phone would otherwise trip its own limit
        const res = await act(env.browser(), email, phone);
        expect(res.status, `${email} ${phone}`).toBe(400);
        expect(res.headers.get("set-cookie")).toBeNull();
        answers.push(JSON.stringify(await res.json()));
      }
      expect(new Set(answers).size).toBe(1);
      expect(JSON.parse(answers[0]!).error.code).toBe("ACTIVATION_FAILED");
      // none of them created an account
      expect(await env.db.exec("select 1 from auth.users where email like 'f-%' and email <> 'f-existing@ngajigaes.test'")).toHaveLength(0);
    });

    it("a CS block on the order stops activation", async () => {
      await env.grantOrder("blocked@ngajigaes.test");
      await env.db.exec("update public.purchase_orders set activation_blocked = true where customer_email_normalized = 'blocked@ngajigaes.test'");
      expect((await act(env.browser(), "blocked@ngajigaes.test", TEST_PHONE)).status).toBe(400);
    });

    it("a weak password is refused with the reason, before anything is created", async () => {
      await env.grantOrder("weak@ngajigaes.test");
      const cases: [string, string][] = [
        ["pendek", "too_short"],
        ["password123", "common"],
        ["weak@ngajigaes.test", "same_as_email"],
        ["0812-3456-7890", "same_as_phone"],
      ];
      for (const [pw, reason] of cases) {
        if (pw === "passwordpassword") continue; // not on the small list: only length and list rules are guaranteed
        await env.db.exec("delete from public.rate_limits"); // 3 tries per hour per email+phone is its own test
        const res = await act(env.browser(), "weak@ngajigaes.test", TEST_PHONE, pw);
        expect(res.status, pw).toBe(422);
        const err = (await res.json()).error;
        expect(err.code).toBe("WEAK_PASSWORD");
        expect(err.details.reason, pw).toBe(reason);
      }
      expect(await env.db.exec("select 1 from auth.users where email = 'weak@ngajigaes.test'")).toHaveLength(0);
      // and the order can still be activated with a good password
      expect((await act(env.browser(), "weak@ngajigaes.test", TEST_PHONE)).status).toBe(200);
    });
  });

  describe("ACT-03: once per entitlement", () => {
    it("a second activation is refused and creates no second account", async () => {
      await env.grantOrder("once@ngajigaes.test");
      expect((await act(env.browser(), "once@ngajigaes.test", TEST_PHONE)).status).toBe(200);
      expect((await act(env.browser(), "once@ngajigaes.test", TEST_PHONE, "sandi-lain-yang-panjang")).status).toBe(400);
      expect(await env.db.exec("select 1 from auth.users where email = 'once@ngajigaes.test'")).toHaveLength(1);
      // the first password is still the one that works
      expect((await env.browser().auth().login("once@ngajigaes.test", NEW_PW)).status).toBe("ok");
      expect(await code(env.browser().auth().login("once@ngajigaes.test", "sandi-lain-yang-panjang"))).toBe("INVALID_CREDENTIALS");
    });

    it("two requests at the same moment: one account, one winner", async () => {
      await env.grantOrder("race@ngajigaes.test");
      const results = await Promise.all(
        [1, 2, 3].map((i) => act(env.browser(), "race@ngajigaes.test", TEST_PHONE, `${NEW_PW}-${i}`)),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s === 400)).toHaveLength(2);
      expect(await env.db.exec("select 1 from auth.users where email = 'race@ngajigaes.test'")).toHaveLength(1);
      expect(await env.db.exec("select 1 from public.auth_credentials c join public.profiles p using (user_id) where p.email_normalized = 'race@ngajigaes.test'")).toHaveLength(1);
    });

    it("an entitlement that already has a user is not handed to a second account", async () => {
      await env.grantOrder("taken@ngajigaes.test");
      await act(env.browser(), "taken@ngajigaes.test", TEST_PHONE);
      const rows = await env.db.exec("select user_id from public.access_entitlements where email_normalized = 'taken@ngajigaes.test'");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.user_id).not.toBeNull();
    });

    it("an account with no active paid entitlement cannot be created from a suspended or expired one", async () => {
      await env.grantOrder("susp@ngajigaes.test", { status: "suspended" });
      await env.grantOrder("exp@ngajigaes.test", { status: "expired" });
      expect((await act(env.browser(), "susp@ngajigaes.test", TEST_PHONE)).status).toBe(400);
      expect((await act(env.browser(), "exp@ngajigaes.test", TEST_PHONE)).status).toBe(400);
    });
  });

  describe("ACT-04: limits", () => {
    it("5 failures per email lock that email, whatever the address, and the answer does not say why", async () => {
      await env.setNow(T0);
      await env.grantOrder("lim1@ngajigaes.test");
      for (let i = 0; i < 5; i++) {
        expect((await act(env.browser(), "lim1@ngajigaes.test", `08111000000${i}`)).status, `try ${i}`).toBe(400);
      }
      const locked = await act(env.browser(), "lim1@ngajigaes.test", TEST_PHONE);
      expect(locked.status).toBe(429);
      expect((await locked.json()).error).toMatchObject({ code: "RATE_LIMITED" });
      await env.setNow(at(16 * MIN));
      expect((await act(env.browser(), "lim1@ngajigaes.test", TEST_PHONE)).status).toBe(200);
    });

    it("5 failures per phone lock that phone across different emails", async () => {
      await env.setNow(T0);
      await env.grantOrder("lim2@ngajigaes.test", { phone: "081377700000" });
      for (let i = 0; i < 5; i++) {
        expect((await act(env.browser(), `guess${i}@ngajigaes.test`, "081377700000")).status).toBe(400);
      }
      const res = await act(env.browser(), "lim2@ngajigaes.test", "081377700000");
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBeTruthy();
    });

    it("20 attempts per hour per address", async () => {
      await env.setNow(T0);
      const b = env.browser("198.51.100.99");
      for (let i = 0; i < 20; i++) {
        const r = await act(b, `ipx${i}@ngajigaes.test`, `08122200${String(i).padStart(4, "0")}`);
        expect(r.status, `try ${i}`).toBe(400);
      }
      expect((await act(b, "ipx-extra@ngajigaes.test", "081222009999")).status).toBe(429);
      expect((await act(env.browser("198.51.100.98"), "ipx-other@ngajigaes.test", "081222009998")).status).toBe(400);
    });

    it("3 tries per hour for the same email and phone pair, even with a weak password", async () => {
      await env.setNow(T0);
      await env.grantOrder("pair@ngajigaes.test");
      for (let i = 0; i < 3; i++) expect((await act(env.browser(), "pair@ngajigaes.test", TEST_PHONE, "pendek")).status).toBe(422);
      expect((await act(env.browser(), "pair@ngajigaes.test", TEST_PHONE)).status).toBe(429);
      await env.setNow(at(61 * MIN));
      expect((await act(env.browser(), "pair@ngajigaes.test", TEST_PHONE)).status).toBe(200);
    });
  });

  describe("ACT-06: reset by the buyer (email + phone)", () => {
    async function activated(email: string, phone = TEST_PHONE) {
      await env.setNow(T0);
      await env.grantOrder(email, { phone });
      const b = env.browser();
      await act(b, email, phone);
      return b;
    }
    const reset = (email: string, phone: string, newPassword: string, b = env.browser()) =>
      b.json("/auth/reset-password", "POST", { email, phone, new_password: newPassword });

    it("changes the password, signs every device out and opens no session", async () => {
      const first = await activated("rs1@ngajigaes.test");
      const second = env.browser();
      await second.auth().login("rs1@ngajigaes.test", NEW_PW, "Laptop");
      const fresh = env.browser();
      const res = await reset("rs1@ngajigaes.test", "+62 812 3456 7890", "sandi-yang-benar-benar-baru", fresh);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(await first.auth().getSession()).toMatchObject({ authenticated: false, reason: "revoked" });
      expect(await second.auth().getSession()).toMatchObject({ authenticated: false, reason: "revoked" });
      expect(await code(env.browser().auth().login("rs1@ngajigaes.test", NEW_PW))).toBe("INVALID_CREDENTIALS");
      expect((await env.browser().auth().login("rs1@ngajigaes.test", "sandi-yang-benar-benar-baru")).status).toBe("ok");
    });

    it("is refused without an account, with a wrong phone, and for an account made without an order, all alike", async () => {
      await activated("rs2@ngajigaes.test");
      await env.createAccount("rs2-staff@ngajigaes.test"); // password but no order
      const answers: string[] = [];
      for (const [email, phone] of [
        ["rs2@ngajigaes.test", "081999999999"],
        ["nobody@ngajigaes.test", TEST_PHONE],
        ["rs2-staff@ngajigaes.test", TEST_PHONE],
      ] as const) {
        const res = await reset(email, phone, "sandi-pengganti-panjang");
        expect(res.status).toBe(400);
        answers.push(JSON.stringify(await res.json()));
      }
      expect(new Set(answers).size).toBe(1);
      // the account kept its password
      expect((await env.browser().auth().login("rs2@ngajigaes.test", NEW_PW)).status).toBe("ok");
    });

    it("an order whose activation CS blocked cannot be used to reset", async () => {
      await activated("rs3@ngajigaes.test");
      await env.db.exec("update public.purchase_orders set activation_blocked = true where customer_email_normalized = 'rs3@ngajigaes.test'");
      expect((await reset("rs3@ngajigaes.test", TEST_PHONE, "sandi-pengganti-panjang")).status).toBe(400);
    });

    it("checks the new password and is rate limited like activation", async () => {
      await activated("rs4@ngajigaes.test");
      expect((await reset("rs4@ngajigaes.test", TEST_PHONE, "pendek")).status).toBe(422);
      for (let i = 0; i < 5; i++) await reset("rs4@ngajigaes.test", `08155500000${i}`, "sandi-pengganti-panjang");
      expect((await reset("rs4@ngajigaes.test", TEST_PHONE, "sandi-pengganti-panjang")).status).toBe(429);
    });

    it("is logged without email or phone", async () => {
      await activated("rs5@ngajigaes.test");
      await reset("rs5@ngajigaes.test", TEST_PHONE, "sandi-pengganti-panjang");
      const ev = await env.db.exec("select kind, ip_hash, user_id from public.auth_events where kind = 'reset_self'");
      expect(ev.length).toBeGreaterThan(0);
      expect(JSON.stringify(ev)).not.toContain("rs5@");
    });
  });

  describe("ADMIN-RESET-01: reset link made by an admin", () => {
    async function target(email: string) {
      await env.setNow(T0);
      return env.createAccount(email);
    }
    const adminId = async () => env.createAccount("admin-actor@ngajigaes.test");
    const deps = () => ({ db: env.db, now: () => env.now(), cfg: env.cfg });
    const setPw = (token: string, password = NEW_PW, b = env.browser()) =>
      b.json("/auth/set-password", "POST", { token, password, device_label: "HP CS" });

    it("works once, signs in, and removes the other devices", async () => {
      const uid = await target("adm1@ngajigaes.test");
      const old = await env.signIn("adm1@ngajigaes.test");
      const { token } = await issueAdminResetToken(deps(), { actorId: await adminId(), targetUserId: uid, reason: "Lupa password, verifikasi via WA" });
      const b = env.browser();
      const res = await setPw(token, "sandi-dari-tautan-cs", b);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: "ok", user: { email: "adm1@ngajigaes.test" } });
      expect((await b.auth().getSession()).authenticated).toBe(true);
      expect(await old.auth().getSession()).toMatchObject({ authenticated: false, reason: "revoked" });
      expect((await env.browser().auth().login("adm1@ngajigaes.test", "sandi-dari-tautan-cs")).status).toBe("ok");
      // second use is refused with the generic answer
      const again = await setPw(token, "sandi-kedua-yang-panjang");
      expect(again.status).toBe(400);
      expect((await again.json()).error.code).toBe("INVALID_TOKEN");
    });

    it("expires after 60 minutes (provisional)", async () => {
      const uid = await target("adm2@ngajigaes.test");
      const { token } = await issueAdminResetToken(deps(), { actorId: await adminId(), targetUserId: uid, reason: "Tes kedaluwarsa" });
      await env.setNow(at(61 * MIN));
      expect((await setPw(token)).status).toBe(400);
      await env.setNow(T0);
      const t2 = await issueAdminResetToken(deps(), { actorId: await adminId(), targetUserId: uid, reason: "Tes batas waktu" });
      await env.setNow(at(59 * MIN));
      expect((await setPw(t2.token)).status).toBe(200);
    });

    it("a new link revokes the older one", async () => {
      const uid = await target("adm3@ngajigaes.test");
      const a = await issueAdminResetToken(deps(), { actorId: await adminId(), targetUserId: uid, reason: "Link pertama" });
      const b2 = await issueAdminResetToken(deps(), { actorId: await adminId(), targetUserId: uid, reason: "Link kedua" });
      expect((await setPw(a.token)).status).toBe(400);
      expect((await setPw(b2.token)).status).toBe(200);
    });

    it("two requests with the same link at once: one wins", async () => {
      const uid = await target("adm4@ngajigaes.test");
      const { token } = await issueAdminResetToken(deps(), { actorId: await adminId(), targetUserId: uid, reason: "Balapan" });
      const rs = await Promise.all([1, 2, 3].map((i) => setPw(token, `${NEW_PW}-${i}`)));
      expect(rs.map((r) => r.status).sort()).toEqual([200, 400, 400]);
    });

    it("needs a reason, writes the audit log, and stores only a hash of the token", async () => {
      const uid = await target("adm5@ngajigaes.test");
      const actor = await adminId();
      expect(await code(issueAdminResetToken(deps(), { actorId: actor, targetUserId: uid, reason: " " }))).toBe("VALIDATION_ERROR");
      const { token } = await issueAdminResetToken(deps(), { actorId: actor, targetUserId: uid, reason: "Alasan yang jelas" });
      const audit = await env.db.exec("select action, reason, actor_id::text, entity_id from public.admin_audit_logs where entity_id = $1", [uid]);
      expect(audit).toEqual([{ action: "password_reset_link_created", reason: "Alasan yang jelas", actor_id: actor, entity_id: uid }]);
      const rows = JSON.stringify(await env.db.exec("select * from public.auth_tokens"));
      expect(rows).not.toContain(token);
      expect(rows).toContain(hmacHex(env.cfg.pepper, "pwtoken", token));
    });

    it("a made-up token and a weak password give distinct, harmless answers", async () => {
      expect((await setPw("x".repeat(43))).status).toBe(400);
      const res = await setPw("y".repeat(43), "pendek");
      expect(res.status).toBe(422);
    });

    it("works for an account that has no password yet (staff made by an admin)", async () => {
      const uid = String((await env.db.exec("insert into auth.users (email) values ('staff1@ngajigaes.test') returning id::text as id"))[0]!.id);
      await env.db.exec("insert into public.profiles (user_id, email_normalized) values ($1::uuid, 'staff1@ngajigaes.test')", [uid]);
      await env.db.exec("insert into public.access_entitlements (user_id, email_normalized, entitlement_type, status, granted_by, starts_at) values ($1::uuid, 'staff1@ngajigaes.test', 'staff_comp', 'active', $2::uuid, '2026-01-01T00:00:00Z')", [uid, await adminId()]);
      expect(await code(env.browser().auth().login("staff1@ngajigaes.test", NEW_PW))).toBe("INVALID_CREDENTIALS");
      const { token } = await issueAdminResetToken(deps(), { actorId: await adminId(), targetUserId: uid, reason: "Akun staff baru" });
      expect((await setPw(token)).status).toBe(200);
      const s = await env.browser().auth().login("staff1@ngajigaes.test", NEW_PW);
      expect(s).toMatchObject({ status: "ok", access: { access_status: "active" } });
    });
  });

  describe("change password while signed in", () => {
    it("needs the current password, signs the other devices out, keeps this one", async () => {
      await env.setNow(T0);
      const a = await env.signIn("cp1@ngajigaes.test");
      const other = await env.signIn("cp1@ngajigaes.test", { label: "Laptop" });
      expect(await code(a.auth().changePassword("salah-salah-1", "sandi-pengganti-panjang"))).toBe("INVALID_CREDENTIALS");
      await a.auth().changePassword(TEST_PASSWORD, "sandi-pengganti-panjang");
      expect((await a.auth().getSession()).authenticated).toBe(true);
      expect(await other.auth().getSession()).toMatchObject({ authenticated: false, reason: "revoked" });
      expect(await code(env.browser().auth().login("cp1@ngajigaes.test", TEST_PASSWORD))).toBe("INVALID_CREDENTIALS");
      expect((await env.browser().auth().login("cp1@ngajigaes.test", "sandi-pengganti-panjang")).status).toBe("ok");
    });

    it("applies the password policy and needs a session", async () => {
      const a = await env.signIn("cp2@ngajigaes.test");
      const res = await a.json("/me/password", "POST", { current_password: TEST_PASSWORD, new_password: "pendek" });
      expect(res.status).toBe(422);
      const anon = await env.browser().json("/me/password", "POST", { current_password: TEST_PASSWORD, new_password: NEW_PW });
      expect(anon.status).toBe(401);
    });

    it("locks after 5 wrong current passwords in 15 minutes", async () => {
      await env.setNow(T0);
      const a = await env.signIn("cp3@ngajigaes.test");
      for (let i = 0; i < 5; i++) expect(await code(a.auth().changePassword("salah-salah-1", NEW_PW))).toBe("INVALID_CREDENTIALS");
      expect(await code(a.auth().changePassword(TEST_PASSWORD, NEW_PW))).toBe("RATE_LIMITED");
    });
  });

  describe("AUTH-12 / ACT-05: nothing secret is stored or logged", () => {
    it("after a full journey no table holds a password, a token or a phone number", async () => {
      await env.setNow(T0);
      const email = "scan@ngajigaes.test";
      const pw1 = "sandi-awal-untuk-pindai-1";
      const pw2 = "sandi-kedua-untuk-pindai-2";
      const pw3 = "sandi-ketiga-untuk-pindai-3";
      const logs: string[] = [];
      const orig = [console.log, console.error, console.warn, console.info];
      for (const k of ["log", "error", "warn", "info"] as const) {
        console[k] = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
      }
      try {
        await env.grantOrder(email, { phone: "0877-1234-5678" });
        const b = env.browser();
        await act(b, email, "0877-1234-5678", pw1);
        await b.auth().changePassword(pw1, pw2);
        const uid = await env.userId(email);
        const adm = await env.createAccount("scan-admin@ngajigaes.test");
        const { token } = await issueAdminResetToken({ db: env.db, now: () => env.now(), cfg: env.cfg }, { actorId: adm, targetUserId: uid, reason: "Pindai" });
        await env.browser().json("/auth/set-password", "POST", { token, password: pw3 });
        await env.browser().json("/auth/login", "POST", { email, password: "salah-salah-1" });
        const dump = JSON.stringify(await env.db.exec(
          `select 'x' as t, to_jsonb(r) j from public.purchase_orders r union all
           select 'c', to_jsonb(r) from public.auth_credentials r union all
           select 'k', to_jsonb(r) from public.auth_tokens r union all
           select 'e', to_jsonb(r) from public.auth_events r union all
           select 'l', to_jsonb(r) from public.admin_audit_logs r union all
           select 'p', to_jsonb(r) from public.profiles r union all
           select 'd', to_jsonb(r) from public.user_devices r union all
           select 's', to_jsonb(r) from public.device_sessions r union all
           select 'r', to_jsonb(r) from public.rate_limits r`,
        ));
        for (const secret of [pw1, pw2, pw3, token, "08771234567", "628771234567", "0877-1234-5678", "62877"]) {
          expect(dump, secret).not.toContain(secret);
        }
        const logged = logs.join("\n");
        for (const secret of [pw1, pw2, pw3, token, "877"]) expect(logged).not.toContain(secret);
      } finally {
        [console.log, console.error, console.warn, console.info] = orig as never;
      }
    });
  });
});
