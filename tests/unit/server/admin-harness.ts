/* eslint-disable @typescript-eslint/no-explicit-any */
import { base32Decode, totp } from "@/server/admin/rules/totp";
import { createApiEnv, type ApiEnv, type TestBrowser } from "./api-harness";

export interface AdminEnv extends ApiEnv {
  /** A signed-in account with these roles. No MFA yet. */
  adminUser(email: string, roles: string[]): Promise<TestBrowser>;
  /** Roles only, for a browser that already exists. */
  giveRoles(email: string, roles: string[]): Promise<void>;
  /** Begin and confirm MFA. Leaves the browser with an admin session. Returns the secret for later sign-ins. */
  enroll(b: TestBrowser): Promise<Buffer>;
  /** A full admin: roles, MFA, admin session. */
  fullAdmin(email: string, roles: string[]): Promise<{ b: TestBrowser; secret: Buffer }>;
  /** MFA code for the app clock now. */
  code(secret: Buffer, offsetSteps?: number): string;
  /** Sign in as admin on an already enrolled account: moves the clock one step so the code is new. */
  mfaLogin(b: TestBrowser, secret: Buffer): Promise<Response>;
  call(b: TestBrowser, method: string, path: string, body?: unknown): Promise<{ status: number; body: any; res: Response }>;
}

export async function createAdminEnv(startAt?: string): Promise<AdminEnv> {
  const base = await createApiEnv(startAt);
  const env = base as AdminEnv;
  env.giveRoles = async (email, roles) => {
    for (const r of roles) {
      await env.db.exec(
        "insert into public.user_roles (user_id, role) select user_id, $2 from public.profiles where email_normalized = $1 on conflict do nothing",
        [email, r],
      );
    }
  };
  env.adminUser = async (email, roles) => {
    const b = await env.signIn(email);
    await env.giveRoles(email, roles);
    return b;
  };
  env.call = async (b, method, path, body) => {
    const res = await b.json(`/admin${path}`, method, body);
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, res };
  };
  env.code = (secret, offset = 0) => totp(secret, env.now().getTime() + offset * 30_000);
  env.enroll = async (b) => {
    const begin = await env.call(b, "POST", "/mfa/begin", {});
    if (begin.status !== 200) throw new Error(`mfa begin ${begin.status} ${JSON.stringify(begin.body)}`);
    const secret = base32Decode(begin.body.secret as string);
    const confirm = await env.call(b, "POST", "/mfa/confirm", { code: env.code(secret) });
    if (confirm.status !== 200) throw new Error(`mfa confirm ${confirm.status} ${JSON.stringify(confirm.body)}`);
    return secret;
  };
  env.fullAdmin = async (email, roles) => {
    const b = await env.adminUser(email, roles);
    return { b, secret: await env.enroll(b) };
  };
  env.mfaLogin = async (b, secret) => {
    await env.setNow(new Date(env.now().getTime() + 31_000).toISOString());
    return b.json("/admin/mfa/verify", "POST", { code: env.code(secret) });
  };
  return env;
}
