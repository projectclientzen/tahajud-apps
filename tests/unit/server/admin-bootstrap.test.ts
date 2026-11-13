import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { grantAdminRole, BootstrapError } from "@/server/admin/bootstrap";
import { createAdminEnv, type AdminEnv } from "./admin-harness";

let env: AdminEnv;
beforeAll(async () => {
  env = await createAdminEnv();
}, 120_000);
afterAll(async () => {
  await env.close();
});
const deps = () => ({ db: env.db, cfg: env.cfg, now: () => env.now() });

describe("scripts/admin-grant-role: first super_admin, no default password", () => {
  it("makes an account with no credentials and no entitlement, grants the role, audits it, and prints a link only to a terminal", async () => {
    const piped = await grantAdminRole(deps(), { email: "Owner@NgajiGaes.test", printLink: true, isTty: false, appBaseUrl: "https://app.test" });
    expect(piped).toMatchObject({ email: "owner@ngajigaes.test", role: "super_admin", accountCreated: true, roleGranted: true });
    expect(piped.link).toBeUndefined();
    expect(piped.notes.join(" ")).toMatch(/bukan terminal/);
    expect((await env.db.exec("select 1 from public.auth_credentials")).length).toBe(0);
    expect((await env.db.exec("select 1 from public.access_entitlements where email_normalized = 'owner@ngajigaes.test'")).length).toBe(0);
    expect((await env.db.exec("select 1 from public.auth_tokens")).length).toBe(0);
    const audit = await env.db.exec("select action, actor_id from public.admin_audit_logs where action = 'role.granted'");
    expect(audit).toEqual([{ action: "role.granted", actor_id: null }]);

    const tty = await grantAdminRole(deps(), { email: "owner@ngajigaes.test", printLink: true, isTty: true, appBaseUrl: "https://app.test" });
    expect(tty.accountCreated).toBe(false);
    expect(tty.roleGranted).toBe(false);
    expect(tty.link).toMatch(/^https:\/\/app\.test\/reset#t=[A-Za-z0-9_-]{40,}$/);
    // Only the keyed hash is stored.
    const token = tty.link!.split("#t=")[1]!;
    expect(JSON.stringify(await env.db.exec("select * from public.auth_tokens"))).not.toContain(token);

    // The owner chooses a password with the link, then signs in as admin (MFA next, as everyone).
    const b = env.browser();
    expect((await b.auth().setPasswordWithToken(token, "kata-sandi-pemilik-55", "Laptop")).status).toBe("ok");
    const me = await env.call(b, "GET", "/me");
    expect(me.body.state).toBe("mfa_setup_required");
    await env.enroll(b);
    expect((await env.call(b, "GET", "/roles")).status).toBe(200);
  });

  it("refuses a second super_admin unless asked, and refuses an unknown role or a bad email", async () => {
    await expect(grantAdminRole(deps(), { email: "lain@ngajigaes.test" })).rejects.toBeInstanceOf(BootstrapError);
    expect((await env.db.exec("select 1 from public.profiles where email_normalized = 'lain@ngajigaes.test'")).length).toBe(0);
    await expect(grantAdminRole(deps(), { email: "lain@ngajigaes.test", role: "root" })).rejects.toBeInstanceOf(BootstrapError);
    await expect(grantAdminRole(deps(), { email: "bukan-email" })).rejects.toBeInstanceOf(BootstrapError);
    const ok = await grantAdminRole(deps(), { email: "cs@ngajigaes.test", role: "support_admin" });
    expect(ok.roleGranted).toBe(true);
  });

  it("does not make a link for an account that already has a password", async () => {
    const r = await grantAdminRole(deps(), { email: "owner@ngajigaes.test", printLink: true, isTty: true, appBaseUrl: "https://app.test" });
    expect(r.link).toBeUndefined();
    expect(r.notes.join(" ")).toMatch(/sudah punya password/);
  });

  it("the script file holds no password and no default value", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("scripts/admin-grant-role.ts", "utf8") + readFileSync("src/server/admin/bootstrap.ts", "utf8");
    expect(src).not.toMatch(/hashPassword|password_hash|password\s*[:=]\s*["`']/i);
  });
});
