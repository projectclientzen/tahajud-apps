import { hmacHex, newSecret } from "@/server/auth/crypto";
import { resolveSession, type AuthedUser, type Caller } from "@/server/auth/service";
import type { Deps } from "@/server/api/deps";
import { one } from "@/server/db";
import { adminCookie, clearAdminCookie, parseAdminCookie } from "./cookie";
import { AdminError } from "./errors";
import { base32Encode, newTotpSecret, openSecret, otpauthUri, sealSecret, verifyTotp } from "./rules/totp";

export interface AdminSession {
  userId: string;
  email: string;
  roles: string[];
  sessionId: string;
  deviceId: string;
  expiresAt: string;
}

/** Where a request stands on the way into /admin. Every step is decided on the server, from the database. */
export type AdminState =
  | { state: "anonymous" }
  | { state: "not_admin"; email: string; user: AuthedUser }
  | { state: "mfa_setup_required"; email: string; user: AuthedUser; roles: string[] }
  | { state: "mfa_required"; email: string; user: AuthedUser; roles: string[] }
  | { state: "ok"; email: string; user: AuthedUser; admin: AdminSession };

interface DbState {
  roles: string[];
  mfa: "none" | "pending" | "verified";
}

const MFA_ATTEMPTS = 8;
const MFA_WINDOW_SECONDS = 600;

export async function resolveAdminState(d: Deps, req: Request): Promise<AdminState> {
  const s = await resolveSession(d, req);
  if (s.state !== "ok") return { state: "anonymous" };
  const user = s.user;
  const st = await d.db.asService((q) => one<DbState>(q, "app_private.admin_state($1::uuid)", [user.userId]));
  if (st.roles.length === 0) return { state: "not_admin", email: user.email, user };
  if (st.mfa !== "verified") return { state: "mfa_setup_required", email: user.email, user, roles: st.roles };
  const cookie = parseAdminCookie(req.headers.get("cookie"));
  if (!cookie) return { state: "mfa_required", email: user.email, user, roles: st.roles };
  const r = await d.db.asService((q) =>
    one<{ state: string; session_id?: string; roles?: string[]; expires_at?: string }>(
      q,
      "app_private.admin_resolve($1::uuid, $2, $3::uuid, $4::uuid, $5::timestamptz)",
      [cookie.sessionId, hmacHex(d.cfg.pepper, "admin", cookie.secret), user.userId, user.deviceId, d.now().toISOString()],
    ),
  );
  if (r.state !== "ok") return { state: "mfa_required", email: user.email, user, roles: st.roles };
  return {
    state: "ok",
    email: user.email,
    user,
    admin: {
      userId: user.userId,
      email: user.email,
      roles: r.roles ?? st.roles,
      sessionId: r.session_id!,
      deviceId: user.deviceId,
      expiresAt: r.expires_at!,
    },
  };
}

/** Step 1 of enrolment: make a secret, keep it sealed, show it once. Refused when a factor is already set. */
export async function beginMfa(d: Deps, user: AuthedUser): Promise<{ secret: string; otpauth_uri: string }> {
  const secret = newTotpSecret();
  await d.db.asService((q) =>
    q.query("select app_private.admin_mfa_begin($1::uuid, $2, $3::timestamptz)", [
      user.userId,
      sealSecret(d.cfg.pepper, secret),
      d.now().toISOString(),
    ]),
  );
  return {
    secret: base32Encode(secret),
    otpauth_uri: otpauthUri({ issuer: "Tahajud Tracker Admin", account: user.email, secret }),
  };
}

async function checkCode(d: Deps, user: AuthedUser, code: string, confirm: boolean): Promise<void> {
  const hit = await d.db.asService((q) =>
    one<{ allowed: boolean; retry_after_seconds: number }>(q, "app_private.rate_hit($1, $2::timestamptz, $3, $4)", [
      `adminmfa:${user.userId}`,
      d.now().toISOString(),
      MFA_WINDOW_SECONDS,
      MFA_ATTEMPTS,
    ]),
  );
  if (!hit.allowed) throw new AdminError("RATE_LIMITED", undefined, { retry_after_seconds: hit.retry_after_seconds });
  const f = await d.db.asService((q) =>
    one<{ secret_enc: string; verified: boolean; last_used_step: string | number } | null>(
      q,
      "app_private.admin_mfa_get($1::uuid)",
      [user.userId],
    ),
  );
  // Confirming needs a pending factor, signing in needs a finished one. Anything else is "not set up".
  if (!f || f.verified === confirm) throw new AdminError("MFA_SETUP_REQUIRED");
  const step = verifyTotp(openSecret(d.cfg.pepper, f.secret_enc), code, d.now().getTime(), Number(f.last_used_step));
  if (step === null) throw new AdminError("INVALID_MFA_CODE");
  const accepted = await d.db.asService((q) =>
    one<boolean>(q, "app_private.admin_mfa_use($1::uuid, $2::bigint, $3::boolean, $4::timestamptz)", [
      user.userId,
      step,
      confirm,
      d.now().toISOString(),
    ]),
  );
  if (!accepted) throw new AdminError("INVALID_MFA_CODE");
}

async function startSession(d: Deps, user: AuthedUser, caller: Caller): Promise<string> {
  const secret = newSecret();
  const now = d.now();
  const r = await d.db.asService((q) =>
    one<{ session_id: string; expires_at: string }>(
      q,
      "app_private.admin_session_create($1::uuid, $2::uuid, $3, $4::timestamptz)",
      [user.userId, user.deviceId, hmacHex(d.cfg.pepper, "admin", secret), now.toISOString()],
    ),
  );
  return adminCookie(r.session_id, secret, new Date(r.expires_at), now, caller.secure);
}

/** Finishes enrolment with the first code, then signs in. */
export async function confirmMfa(d: Deps, user: AuthedUser, code: string, caller: Caller): Promise<string> {
  await checkCode(d, user, code, true);
  return startSession(d, user, caller);
}

/** Sign-in step: a right code starts the 8 hour admin session. */
export async function verifyMfa(d: Deps, user: AuthedUser, code: string, caller: Caller): Promise<string> {
  await checkCode(d, user, code, false);
  return startSession(d, user, caller);
}

export async function endAdminSession(d: Deps, req: Request, userId: string, secure: boolean): Promise<string> {
  const cookie = parseAdminCookie(req.headers.get("cookie"));
  if (cookie) {
    await d.db.asService((q) =>
      q.query("select app_private.admin_session_end($1::uuid, $2::uuid, $3::timestamptz)", [
        cookie.sessionId,
        userId,
        d.now().toISOString(),
      ]),
    );
  }
  return clearAdminCookie(secure);
}
