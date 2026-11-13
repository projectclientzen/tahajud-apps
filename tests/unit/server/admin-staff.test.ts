/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_PASSWORD, TEST_PHONE } from "./api-harness";
import { createAdminEnv, type AdminEnv } from "./admin-harness";

let env: AdminEnv;
beforeAll(async () => {
  env = await createAdminEnv();
}, 120_000);
afterAll(async () => {
  await env.close();
});

const REASON = "Alasan uji yang cukup panjang";
const tokenOf = (link: string) => new URL(link).hash.replace(/^#t=/, "");

describe("X8 staff accounts over HTTP", () => {
  it("only a super_admin can create, list or revoke staff", async () => {
    const { b } = await env.fullAdmin("cs-staff@ngajigaes.test", ["support_admin"]);
    for (const [m, p, body] of [
      ["GET", "/staff", undefined],
      ["POST", "/staff", { email: "x@ngajigaes.test", reason: REASON }],
      ["POST", "/staff/00000000-0000-4000-8000-000000000001/revoke", { reason: REASON }],
    ] as const) {
      const r = await env.call(b, m, p, body);
      expect(r.status, `${m} ${p}`).toBe(403);
    }
  });

  it("creates the account without a password, shows one link once, and the staff member sets their own password", async () => {
    const { b } = await env.fullAdmin("root-staff@ngajigaes.test", ["super_admin"]);
    // Strict body: a password field is refused, so an admin cannot pick one.
    const withPw = await env.call(b, "POST", "/staff", { email: "tim1@ngajigaes.test", reason: REASON, password: "rahasia-123456" });
    expect(withPw.status).toBe(400);

    const made = await env.call(b, "POST", "/staff", { email: "Tim1@NgajiGaes.test", display_name: "Tim Satu", reason: REASON });
    expect(made.status).toBe(200);
    expect(made.body.link).toMatch(/\/reset#t=[A-Za-z0-9_-]{40,}$/);
    expect(made.body.entitlement).toMatchObject({ entitlement_type: "staff_comp", status: "active", email: "tim1@ngajigaes.test" });
    expect(made.res.headers.get("cache-control")).toMatch(/no-store/);

    // Not signed in yet: no credentials row, so no password works (not even the shared test one).
    await expect(env.browser().auth().login("tim1@ngajigaes.test", TEST_PASSWORD, "HP")).rejects.toThrow();
    expect((await env.db.exec("select 1 from public.auth_credentials c join public.profiles p using (user_id) where p.email_normalized = 'tim1@ngajigaes.test'")).length).toBe(0);

    // The raw token is nowhere in the database.
    const token = tokenOf(made.body.link);
    expect(JSON.stringify(await env.db.exec("select token_hash, user_id::text, created_by::text from public.auth_tokens"))).not.toContain(token);
    expect(JSON.stringify(await env.db.exec("select * from public.admin_audit_logs"))).not.toContain(token);

    // The staff member opens the link and chooses a password. That works once.
    const b2 = env.browser();
    const set = await b2.auth().setPasswordWithToken(token, "kata-sandi-pilihan-staf-77", "HP staf");
    expect(set.status).toBe("ok");
    const reuse = await env.browser().json("/auth/set-password", "POST", { token, password: "kata-sandi-lain-staf-88" });
    expect(reuse.status).toBe(400);
    expect((await env.browser().auth().login("tim1@ngajigaes.test", "kata-sandi-pilihan-staf-77", "HP lain")).status).toBe("ok");

    // Staff have access without any purchase, and every level is open.
    expect((await b2.data().access.getAccess()).access_status).toBe("active");
    expect((await env.db.exec("select 1 from public.purchase_orders where customer_email_normalized = 'tim1@ngajigaes.test'")).length).toBe(0);
    expect((await b2.data().progress.getCurrentLevel()).level).toBe(3);
  });

  it("a staff account is refused without a reason, a bad email, a duplicate, and an email that has a paid order", async () => {
    const { b } = await env.fullAdmin("root-staff2@ngajigaes.test", ["super_admin"]);
    expect((await env.call(b, "POST", "/staff", { email: "a@ngajigaes.test", reason: "pendek" })).status).toBe(400);
    expect((await env.call(b, "POST", "/staff", { email: "bukan-email", reason: REASON })).status).toBe(400);
    expect((await env.call(b, "POST", "/staff", { email: "dup@ngajigaes.test", reason: REASON })).status).toBe(200);
    expect((await env.call(b, "POST", "/staff", { email: "dup@ngajigaes.test", reason: REASON })).status).toBe(409);
    await env.grantOrder("sudah-beli@ngajigaes.test");
    expect((await env.call(b, "POST", "/staff", { email: "sudah-beli@ngajigaes.test", reason: REASON })).status).toBe(409);
  });

  it("revoking stops access, is listed, and is audited", async () => {
    const { b } = await env.fullAdmin("root-staff3@ngajigaes.test", ["super_admin"]);
    const made = await env.call(b, "POST", "/staff", { email: "tim3@ngajigaes.test", reason: REASON });
    const sb = env.browser();
    expect((await sb.auth().setPasswordWithToken(tokenOf(made.body.link), "kata-sandi-pilihan-staf-77", "HP")).status).toBe("ok");
    expect((await sb.data().access.getAccess()).access_status).toBe("active");
    const rev = await env.call(b, "POST", `/staff/${made.body.entitlement.id}/revoke`, { reason: REASON });
    expect(rev.status).toBe(200);
    expect(rev.body.status).toBe("revoked");
    expect((await sb.data().access.getAccess()).access_status).not.toBe("active");
    const list = await env.call(b, "GET", "/staff");
    expect(list.body.find((s: any) => s.email === "tim3@ngajigaes.test")).toMatchObject({ status: "revoked", has_password: true });
    const log = await env.call(b, "GET", "/audit-logs?limit=100");
    const actions = log.body.entries.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["staff.created", "staff.revoked", "password_reset_link_created"]));
  });
});

describe("X8 reset links for buyers", () => {
  it("needs a reason, shows the link once, expires, and a new link revokes the old one", async () => {
    const { b } = await env.fullAdmin("cs-reset@ngajigaes.test", ["support_admin"]);
    const buyerEmail = "pembeli-reset@ngajigaes.test";
    await env.grantOrder(buyerEmail);
    const uid = await env.createAccount(buyerEmail);

    expect((await env.call(b, "POST", `/users/${uid}/reset-link`, { reason: "x" })).status).toBe(400);
    const one = await env.call(b, "POST", `/users/${uid}/reset-link`, { reason: REASON });
    expect(one.status).toBe(200);
    expect(JSON.stringify(one.body)).not.toMatch(/token_hash/);
    const t1 = tokenOf(one.body.link);
    const two = await env.call(b, "POST", `/users/${uid}/reset-link`, { reason: REASON });
    const t2 = tokenOf(two.body.link);
    expect(t2).not.toBe(t1);

    // New link revoked the old one.
    expect((await env.browser().json("/auth/set-password", "POST", { token: t1, password: "kata-sandi-baru-pembeli-1" })).status).toBe(400);

    // Expiry: 60 minutes (PROVISIONAL).
    expect(new Date(two.body.expires_at).getTime() - env.now().getTime()).toBe(60 * 60 * 1000);
    await env.setNow(new Date(env.now().getTime() + 61 * 60 * 1000).toISOString());
    expect((await env.browser().json("/auth/set-password", "POST", { token: t2, password: "kata-sandi-baru-pembeli-1" })).status).toBe(400);

    // A fresh link works once, signs in the new device, and signs every old device out.
    await env.setNow(new Date(env.now().getTime() + 1000).toISOString());
    const old = await env.signIn(buyerEmail);
    expect((await old.data().access.getAccess()).access_status).toBe("active");
    const three = await env.call(b, "POST", `/users/${uid}/reset-link`, { reason: REASON });
    const fresh = env.browser();
    expect((await fresh.auth().setPasswordWithToken(tokenOf(three.body.link), "kata-sandi-baru-pembeli-1", "HP baru")).status).toBe("ok");
    expect((await fresh.data().access.getAccess()).access_status).toBe("active");
    await expect(old.data().access.getAccess()).rejects.toThrow();
    expect((await env.browser().json("/auth/set-password", "POST", { token: tokenOf(three.body.link), password: "kata-sandi-baru-pembeli-2" })).status).toBe(400);
  });

  it("every link is audited with who, why and for whom, and never contains the token", async () => {
    const { b } = await env.fullAdmin("cs-reset2@ngajigaes.test", ["support_admin"]);
    const uid = await env.createAccount("pembeli-reset2@ngajigaes.test");
    const r = await env.call(b, "POST", `/users/${uid}/reset-link`, { reason: REASON });
    const token = tokenOf(r.body.link);
    const rows = await env.db.exec("select actor_id::text, entity_id, action, reason from public.admin_audit_logs where action = 'password_reset_link_created' and entity_id = $1", [uid]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: REASON, entity_id: uid });
    expect(JSON.stringify(await env.db.exec("select * from public.admin_audit_logs"))).not.toContain(token);
  });

  it("a buyer without an account gets a clear 404; a support admin cannot reset an admin account; reporting role cannot", async () => {
    const { b } = await env.fullAdmin("cs-reset3@ngajigaes.test", ["support_admin"]);
    expect((await env.call(b, "POST", "/users/00000000-0000-4000-8000-0000000000ee/reset-link", { reason: REASON })).status).toBe(404);
    const { b: sb } = await env.fullAdmin("root-reset3@ngajigaes.test", ["super_admin"]);
    const rootId = await env.userId("root-reset3@ngajigaes.test");
    expect((await env.call(b, "POST", `/users/${rootId}/reset-link`, { reason: REASON })).status).toBe(403);
    expect((await env.call(sb, "POST", `/users/${await env.userId("cs-reset3@ngajigaes.test")}/reset-link`, { reason: REASON })).status).toBe(200);
    const { b: rb } = await env.fullAdmin("report-reset3@ngajigaes.test", ["reporting_admin"]);
    expect((await env.call(rb, "POST", `/users/${rootId}/reset-link`, { reason: REASON })).status).toBe(403);
  });
});

describe("X8 orders: approve, block, phone check", () => {
  it("a quarantined order can be approved by hand, then the buyer activates with the same phone", async () => {
    const { b } = await env.fullAdmin("cs-order@ngajigaes.test", ["support_admin"]);
    const email = "order-manual@ngajigaes.test";
    const id = (
      await env.db.exec(
        "insert into public.purchase_orders (scalev_order_id, customer_email_normalized, payment_status, verified_via, customer_phone_hash, quarantine_reason) values ('M-1', $1, 'paid', 'scalev_api', $2, 'spam_flag') returning id::text as id",
        [email, (await import("@/server/auth/crypto")).hashPhone(env.cfg.pepper, TEST_PHONE)],
      )
    )[0]!.id as string;

    const detail = await env.call(b, "GET", `/orders/${id}`);
    expect(detail.body.order).toMatchObject({ quarantine_reason: "spam_flag", phone_on_file: true });
    expect(detail.body.can_approve).toBe(true);
    expect((await env.call(b, "POST", `/orders/${id}/approve`, { reason: REASON })).status).toBe(400);
    const ok = await env.call(b, "POST", `/orders/${id}/approve`, { reason: REASON, approval_reference: "bukti-1" });
    expect(ok.status).toBe(200);
    expect(ok.body.order.verified_via).toBe("admin_manual");

    const act = await env.browser().auth().activate({ email, phone: TEST_PHONE, password: "kata-sandi-aktivasi-99", deviceLabel: "HP" });
    expect(act.status).toBe("ok");
  });

  it("blocking makes activation fail; unblocking restores it; both are audited and need a reason", async () => {
    const { b } = await env.fullAdmin("cs-order2@ngajigaes.test", ["support_admin"]);
    const email = "order-block@ngajigaes.test";
    const id = await env.grantOrder(email);
    expect((await env.call(b, "POST", `/orders/${id}/activation-block`, { blocked: true, reason: "x" })).status).toBe(400);
    expect((await env.call(b, "POST", `/orders/${id}/activation-block`, { blocked: true, reason: REASON })).status).toBe(200);
    expect((await env.call(b, "POST", `/orders/${id}/activation-block`, { blocked: true, reason: REASON })).status).toBe(409);
    const blocked = await env.browser().json("/auth/activate", "POST", { email, phone: TEST_PHONE, password: "kata-sandi-aktivasi-99", device_label: "HP" });
    expect(blocked.status).toBe(400);
    expect((await env.call(b, "POST", `/orders/${id}/activation-block`, { blocked: false, reason: REASON })).status).toBe(200);
    const open = await env.browser().json("/auth/activate", "POST", { email, phone: TEST_PHONE, password: "kata-sandi-aktivasi-99", device_label: "HP" });
    expect(open.status).toBe(200);
  });

  it("phone check: match yes or no, no phone in any admin response, content role refused", async () => {
    const { b } = await env.fullAdmin("cs-order3@ngajigaes.test", ["support_admin"]);
    const id = await env.grantOrder("order-phone@ngajigaes.test");
    const yes = await env.call(b, "POST", `/orders/${id}/phone-check`, { phone: "+62 812-3456-7890" });
    expect(yes.body).toEqual({ match: true, phone_on_file: true });
    const no = await env.call(b, "POST", `/orders/${id}/phone-check`, { phone: "0811 111 1111" });
    expect(no.body).toEqual({ match: false, phone_on_file: true });
    expect((await env.call(b, "POST", `/orders/${id}/phone-check`, { phone: "abc" })).status).toBe(400);

    const bodies = [
      JSON.stringify(yes.body), JSON.stringify(no.body),
      JSON.stringify((await env.call(b, "GET", `/orders/${id}`)).body),
      JSON.stringify((await env.call(b, "GET", "/orders?limit=100")).body),
      JSON.stringify((await env.call(b, "GET", "/search?q=order-phone")).body),
      JSON.stringify((await env.call(b, "GET", "/audit-logs?limit=100")).body),
    ].join(" ");
    expect(bodies).not.toMatch(/81234567890|812-3456|phone_hash|customer_phone/);
    const hash = (await import("@/server/auth/crypto")).hashPhone(env.cfg.pepper, TEST_PHONE)!;
    expect(bodies).not.toContain(hash);

    const { b: cb } = await env.fullAdmin("content-order3@ngajigaes.test", ["content_admin"]);
    expect((await env.call(cb, "POST", `/orders/${id}/phone-check`, { phone: TEST_PHONE })).status).toBe(403);
    expect((await env.call(cb, "GET", `/orders/${id}`)).status).toBe(403);
  });
});

describe("PRIV-01 over HTTP: no admin response carries excused or per-user worship data", () => {
  it("every readable admin endpoint for every role is free of excuse and progress keys", async () => {
    const email = "privacy-user@ngajigaes.test";
    const user = await env.onboarded(email);
    void user;
    const { b } = await env.fullAdmin("root-priv@ngajigaes.test", ["super_admin"]);
    const uid = await env.userId(email);
    const paths = ["/dashboard", "/search?q=privacy-user", `/users/${uid}`, "/orders?limit=100", "/entitlements?limit=100", "/staff", "/jobs", "/health", "/audit-logs?limit=100", "/roles"];
    for (const p of paths) {
      const r = await env.call(b, "GET", p);
      expect(r.status, p).toBe(200);
      expect(JSON.stringify(r.body), p).not.toMatch(/excus|berhalangan|night_session|session_activit|counter_operation|reading_progress/i);
    }
  });
});
