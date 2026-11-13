import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminEnv, type AdminEnv } from "./admin-harness";

let env: AdminEnv;
beforeAll(async () => {
  env = await createAdminEnv();
}, 120_000);
afterAll(async () => {
  await env.close();
});

describe("SECURITY-05: /admin refuses anyone who is not a full admin", () => {
  it("anonymous: 401 on every kind of endpoint", async () => {
    const b = env.browser();
    for (const [m, p] of [["GET", "/dashboard"], ["GET", "/users/x"], ["GET", "/audit-logs"], ["GET", "/roles"]] as const) {
      const r = await env.call(b, m, p);
      expect(r.status, `${m} ${p}`).toBe(401);
      expect(r.body.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("signed in but no role: 403 everywhere, and /me says not_admin", async () => {
    const b = await env.signIn("plain@ngajigaes.test");
    expect((await env.call(b, "GET", "/me")).body.state).toBe("not_admin");
    for (const p of ["/dashboard", "/levels", "/search?q=abc", "/health", "/audit-logs", "/roles", "/templates"]) {
      const r = await env.call(b, "GET", p);
      expect(r.status, p).toBe(403);
      expect(r.body.error.code).toBe("FORBIDDEN");
    }
    const begin = await env.call(b, "POST", "/mfa/begin", {});
    expect(begin.status).toBe(403);
  });

  it("a role without MFA: refused with MFA_SETUP_REQUIRED, never the data", async () => {
    const b = await env.adminUser("nomfa@ngajigaes.test", ["super_admin"]);
    expect((await env.call(b, "GET", "/me")).body.state).toBe("mfa_setup_required");
    for (const p of ["/dashboard", "/roles", "/audit-logs", "/levels"]) {
      const r = await env.call(b, "GET", p);
      expect(r.status, p).toBe(401);
      expect(r.body.error.code).toBe("MFA_SETUP_REQUIRED");
      expect(JSON.stringify(r.body)).not.toMatch(/entries|roles":\[/);
    }
  });

  it("MFA enrolled but not verified on this session: ADMIN_MFA_REQUIRED, then a right code opens it", async () => {
    const { b, secret } = await env.fullAdmin("mfa2@ngajigaes.test", ["super_admin"]);
    expect((await env.call(b, "GET", "/dashboard")).status).toBe(200);
    // A second browser signs in with the same account: signed in, no admin session yet.
    const b2 = await env.signIn("mfa2@ngajigaes.test");
    const state = await env.call(b2, "GET", "/me");
    expect(state.body.state).toBe("mfa_required");
    const refused = await env.call(b2, "GET", "/dashboard");
    expect(refused.status).toBe(401);
    expect(refused.body.error.code).toBe("ADMIN_MFA_REQUIRED");
    const ok = await env.mfaLogin(b2, secret);
    expect(ok.status).toBe(200);
    expect((await env.call(b2, "GET", "/dashboard")).status).toBe(200);
  });

  it("a wrong code and a replayed code are refused", async () => {
    const { b, secret } = await env.fullAdmin("replay@ngajigaes.test", ["support_admin"]);
    const b2 = await env.signIn("replay@ngajigaes.test");
    await env.setNow(new Date(env.now().getTime() + 31_000).toISOString());
    const wrong = await env.call(b2, "POST", "/mfa/verify", { code: "000000" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("INVALID_MFA_CODE");
    const good = env.code(secret);
    expect((await env.call(b2, "POST", "/mfa/verify", { code: good })).status).toBe(200);
    // The same code on a third device: already used for that time step.
    const b3 = await env.signIn("replay@ngajigaes.test");
    const again = await env.call(b3, "POST", "/mfa/verify", { code: good });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe("INVALID_MFA_CODE");
    void b;
  });

  it("MFA tries are limited", async () => {
    const b = await env.adminUser("limit@ngajigaes.test", ["content_admin"]);
    await env.enroll(b);
    const b2 = await env.signIn("limit@ngajigaes.test");
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await env.call(b2, "POST", "/mfa/verify", { code: "111111" })).status;
    expect(last).toBe(429);
  });

  it("the admin cookie is HttpOnly, SameSite=Strict and lasts 8 hours at most", async () => {
    const b = await env.adminUser("cookie@ngajigaes.test", ["super_admin"]);
    const begin = await env.call(b, "POST", "/mfa/begin", {});
    const { base32Decode } = await import("@/server/admin/rules/totp");
    const confirm = await b.json("/admin/mfa/confirm", "POST", { code: env.code(base32Decode(begin.body.secret)) });
    const set = confirm.headers.getSetCookie().find((c) => c.startsWith("tt_admin="))!;
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Strict/);
    const maxAge = Number(/Max-Age=(\d+)/.exec(set)![1]);
    expect(maxAge).toBeLessThanOrEqual(8 * 3600);
    expect(maxAge).toBeGreaterThan(8 * 3600 - 60);
  });

  it("the session ends after 8 hours, with no sliding", async () => {
    const { b } = await env.fullAdmin("expiry@ngajigaes.test", ["super_admin"]);
    await env.setNow(new Date(env.now().getTime() + 7 * 3600_000 + 55 * 60_000).toISOString());
    expect((await env.call(b, "GET", "/dashboard")).status).toBe(200);
    await env.setNow(new Date(env.now().getTime() + 10 * 60_000).toISOString());
    const r = await env.call(b, "GET", "/dashboard");
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("ADMIN_MFA_REQUIRED");
  });

  it("removing a role takes effect on the next request", async () => {
    const { b } = await env.fullAdmin("demote@ngajigaes.test", ["support_admin", "super_admin"]);
    expect((await env.call(b, "GET", "/roles")).status).toBe(200);
    await env.db.exec("delete from public.user_roles where role = 'super_admin' and user_id = (select user_id from public.profiles where email_normalized = 'demote@ngajigaes.test')");
    expect((await env.call(b, "GET", "/roles")).status).toBe(403);
    expect((await env.call(b, "GET", "/search?q=zzz")).status).toBe(200);
  });

  it("logging the sign-in device out ends the admin session too", async () => {
    const { b } = await env.fullAdmin("device@ngajigaes.test", ["super_admin"]);
    expect((await env.call(b, "GET", "/dashboard")).status).toBe(200);
    await b.json("/auth/logout", "POST", {});
    expect((await env.call(b, "GET", "/dashboard")).status).toBe(401);
  });

  it("mutations need the app Origin", async () => {
    const { b } = await env.fullAdmin("origin@ngajigaes.test", ["super_admin"]);
    const r = await b.json("/admin/logout", "POST", {}, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("FORBIDDEN_ORIGIN");
    const none = await b.raw("/admin/roles/grant", { method: "POST", headers: { "content-type": "application/json", origin: "" }, body: "{}" });
    expect(none.status).toBe(403);
  });

  it("every answer is no-store", async () => {
    const b = env.browser();
    const r = await b.raw("/admin/dashboard");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const nf = await b.raw("/admin/nope");
    expect(nf.status).toBe(404);
    expect(nf.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("RBAC: each role reaches its own area and nothing else (PRD §18.2)", () => {
  const GET = {
    super_admin: [
      "/dashboard",
      "/levels",
      "/activities?group=dhikr",
      "/activities?group=activities",
      "/templates",
      "/search?q=abcd",
      "/orders",
      "/entitlements",
      "/health",
      "/jobs",
      "/audit-logs",
      "/roles",
      "/quran-content",
    ],
    content_admin: ["/dashboard", "/levels", "/activities?group=dhikr", "/activities?group=activities", "/templates", "/quran-content", "/audit-logs"],
    support_admin: ["/dashboard", "/search?q=abcd", "/orders", "/entitlements", "/health", "/jobs", "/audit-logs"],
    reporting_admin: ["/dashboard"],
  } as const;
  const ALL = [...new Set(Object.values(GET).flat())].filter((p) => p !== "/dashboard");

  for (const role of Object.keys(GET) as (keyof typeof GET)[]) {
    it(`${role}: allowed list works, the rest is 403`, async () => {
      const { b } = await env.fullAdmin(`rbac-${role}@ngajigaes.test`, [role]);
      for (const p of GET[role]) {
        const r = await env.call(b, "GET", p);
        expect(r.status, `${role} ${p}`).toBe(200);
      }
      for (const p of ALL.filter((x) => !(GET[role] as readonly string[]).includes(x))) {
        const r = await env.call(b, "GET", p);
        expect(r.status, `${role} ${p}`).toBe(403);
      }
    });
  }

  it("the database refuses on its own when TypeScript is wrong (roles passed that the actor lacks)", async () => {
    const { b } = await env.fullAdmin("sqlcheck@ngajigaes.test", ["reporting_admin"]);
    const uid = await env.userId("sqlcheck@ngajigaes.test");
    void b;
    await expect(
      env.db.exec("select app_private.admin_search($1::uuid, '{support_admin}'::text[], 'abcd')", [uid]),
    ).rejects.toMatchObject({ message: "FORBIDDEN" });
  });
});
