import { isPlausibleEmail, normalizeEmail } from "@/domain/auth/email";
import { PASSWORD_PROBLEM_MESSAGE, checkPassword } from "@/domain/auth/password-policy";
import { PROVISIONAL_AUTH } from "@/domain/config/provisional";
import {
  ApiError,
  type Device,
  type DeviceLimitResponse,
  type Access,
  type AuthSession,
  type SignInResponse,
} from "@/data/contracts";
import { one, UUID_RE, type Db } from "@/server/db";
import type { AuthConfig } from "./config";
import { clearSessionCookie, parseSessionCookie, sessionCookie } from "./cookie";
import { hashPhone, hmacHex, newSecret } from "./crypto";
import { dummyHash, hashPassword, needsRehash, verifyPassword } from "./password";

export interface AuthDeps {
  db: Db;
  now: () => Date;
  cfg: AuthConfig;
}

export interface AuthedUser {
  userId: string;
  email: string;
  deviceId: string;
  expiresAt: string;
}

export type SessionState = { state: "ok"; user: AuthedUser } | { state: "none" | "expired" | "revoked" };

const BAD_LOGIN = "Email atau password salah.";
const ACTIVATION_FAILED = "Data tidak cocok atau akun sudah aktif. Coba masuk, atau hubungi CS.";
const BAD_TOKEN = "Tautan tidak berlaku atau sudah dipakai. Minta tautan baru ke CS.";
const L = PROVISIONAL_AUTH.limits;

/** What one request needs to know about its caller. The IP is hashed before it becomes a key. */
export interface Caller {
  ip: string;
  secure: boolean;
}

/**
 * The client address is the entry `trustedHops` places from the END of X-Forwarded-For: that is the one our own
 * proxy appended. Entries to the left are whatever the client sent, so they are never used as the address.
 * With 0 trusted proxies the header is ignored.
 */
export function callerOf(req: Request, trustedHops = 1): Caller {
  const entries =
    req.headers
      .get("x-forwarded-for")
      ?.split(",")
      .map((x) => x.trim())
      .filter(Boolean) ?? [];
  let ip = "unknown";
  if (trustedHops > 0) {
    const picked = entries.length > 0 ? entries[Math.max(0, entries.length - trustedHops)] : req.headers.get("x-real-ip")?.trim();
    if (picked) ip = picked.slice(0, 64);
  }
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return { ip, secure: proto ? proto === "https" : new URL(req.url).protocol === "https:" };
}

const tooMany = (retry: number) =>
  // One message for every limit. It never says which counter (email, phone, IP) ran out.
  new ApiError("RATE_LIMITED", "Terlalu sering mencoba. Coba lagi sebentar.", { retry_after_seconds: retry });

interface Hit {
  allowed: boolean;
  retry_after_seconds: number;
}

/** Counts this attempt and refuses when the window is full. */
async function hit(d: AuthDeps, key: string, windowSeconds: number, limit: number): Promise<void> {
  const res = await d.db.asService((q) =>
    one<Hit>(q, "app_private.rate_hit($1, $2::timestamptz, $3, $4)", [key, d.now().toISOString(), windowSeconds, limit]),
  );
  if (!res.allowed) throw tooMany(res.retry_after_seconds);
}

/** Refuses when the failure counter is already full, without counting this attempt. */
async function assertFailBudget(d: AuthDeps, key: string, windowSeconds: number, limit: number): Promise<void> {
  const n = await d.db.asService((q) =>
    one<number>(q, "app_private.rate_count($1, $2::timestamptz, $3)", [key, d.now().toISOString(), windowSeconds]),
  );
  if (n >= limit) throw tooMany(windowSeconds);
}

const recordFail = (d: AuthDeps, key: string, windowSeconds: number): Promise<unknown> =>
  d.db.asService((q) =>
    one<Hit>(q, "app_private.rate_hit($1, $2::timestamptz, $3, $4)", [
      key,
      d.now().toISOString(),
      windowSeconds,
      1_000_000,
    ]),
  );

const keyOf = (d: AuthDeps, scope: string, kind: string, value: string): string =>
  `${scope}:${kind}:${hmacHex(d.cfg.pepper, kind, value)}`;

const ipHashOf = (d: AuthDeps, caller: Caller): string => hmacHex(d.cfg.pepper, "ip", caller.ip);

function assertPolicy(password: string, ctx: { email?: string; phone?: string } = {}): void {
  const problem = checkPassword(password, ctx);
  if (problem) throw new ApiError("WEAK_PASSWORD", PASSWORD_PROBLEM_MESSAGE[problem], { reason: problem });
}

const cleanLabel = (raw: string | undefined): string => {
  const s = (raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 60);
  return s || "Perangkat baru";
};

interface StartResult {
  status: "ok" | "device_limit";
  device_id?: string;
  expires_at?: string;
  max_devices?: number;
  user_id?: string;
}

export type SignInOutcome =
  | { kind: "ok"; body: SignInResponse & { status: "ok" }; cookie: string }
  | { kind: "device_limit"; body: DeviceLimitResponse };

async function accessOf(d: AuthDeps, uid: string): Promise<Access> {
  return d.db.asUser(uid, (q) => one<Access>(q, "public.get_access()"));
}

/**
 * Opens a session on this device for a user whose password (or reset link, or activation) was just proven.
 * On a 4th device nothing is created, only a 10 minute permission to remove one device (PRD §24.1).
 */
async function startSignIn(
  d: AuthDeps,
  userId: string,
  email: string,
  deviceLabel: string | undefined,
  caller: Caller,
): Promise<SignInOutcome> {
  const now = d.now();
  const secret = newSecret();
  const pendingToken = newSecret();
  const label = cleanLabel(deviceLabel);
  const start = await d.db.asService(async (q) => {
    const r = await one<StartResult>(q, "app_private.start_device_session($1::uuid, $2, $3, $4::timestamptz)", [
      userId,
      label,
      hmacHex(d.cfg.pepper, "session", secret),
      now.toISOString(),
    ]);
    if (r.status === "ok") return { start: r, pending: null };
    const pending = await one<{ pending_expires_at: string; devices: Device[] }>(
      q,
      "app_private.create_pending_login($1::uuid, $2, $3::timestamptz)",
      [userId, hmacHex(d.cfg.pepper, "pending", pendingToken), now.toISOString()],
    );
    return { start: r, pending };
  });

  if (start.pending) {
    return {
      kind: "device_limit",
      body: {
        status: "device_limit",
        max_devices: start.start.max_devices ?? PROVISIONAL_AUTH.maxActiveDevices,
        pending_token: pendingToken,
        pending_expires_at: start.pending.pending_expires_at,
        devices: start.pending.devices,
      },
    };
  }
  const r = start.start;
  return {
    kind: "ok",
    body: {
      status: "ok",
      user: { id: userId, email },
      device_id: r.device_id!,
      expires_at: r.expires_at!,
      access: await accessOf(d, userId),
    },
    cookie: sessionCookie(r.device_id!, secret, new Date(r.expires_at!), now, caller.secure),
  };
}

/**
 * POST /auth/login. Wrong email, wrong password and "no such account" give the same answer after the same work
 * (a hash check always runs). Only failures count toward the per-email limit: a correct login never locks anyone out.
 */
export async function login(
  d: AuthDeps,
  input: { email: string; password: string; deviceLabel?: string },
  caller: Caller,
): Promise<SignInOutcome> {
  await hit(d, keyOf(d, "login", "ip", caller.ip), 600, L.loginIpPer10Min);
  const email = normalizeEmail(input.email);
  const failKey = keyOf(d, "loginfail", "email", email);
  await assertFailBudget(d, failKey, L.loginFailWindowSeconds, L.loginFailsPerEmail);

  const cred = isPlausibleEmail(email)
    ? await d.db.asService((q) =>
        one<{ user_id: string; password_hash: string } | null>(q, "app_private.credential_for_login($1)", [email]),
      )
    : null;
  const stored = cred?.password_hash ?? (await dummyHash(d.cfg.scrypt));
  const matches = await verifyPassword(input.password, stored);
  if (!cred || !matches) {
    await recordFail(d, failKey, L.loginFailWindowSeconds);
    throw new ApiError("INVALID_CREDENTIALS", BAD_LOGIN);
  }
  if (needsRehash(cred.password_hash, d.cfg.scrypt)) {
    const fresh = await hashPassword(input.password, d.cfg.scrypt);
    await d.db.asService((q) =>
      q.query("select app_private.credential_rehash($1::uuid, $2, $3, $4::timestamptz)", [
        cred.user_id,
        cred.password_hash,
        fresh,
        d.now().toISOString(),
      ]),
    );
  }
  return startSignIn(d, cred.user_id, email, input.deviceLabel, caller);
}

interface Proof {
  email: string;
  phoneHash: string | null;
  failKeys: string[];
}

/**
 * Limits shared by activation and the buyer's own reset (CLAUDE.md: per email, per phone, per IP, answers that do
 * not say which one). Returns the normalized proof. The caller then hashes the new password and asks the database.
 */
async function proveWithLimits(
  d: AuthDeps,
  scope: "act" | "rst",
  input: { email: string; phone: string },
  caller: Caller,
): Promise<Proof> {
  if (!isPlausibleEmail(input.email)) throw new ApiError("VALIDATION_ERROR", "Format email belum benar.");
  const email = normalizeEmail(input.email);
  const phoneHash = hashPhone(d.cfg.pepper, input.phone);
  await hit(d, keyOf(d, scope, "ip", caller.ip), 3600, L.activateIpPerHour);
  await hit(d, keyOf(d, `${scope}pair`, "pair", `${email}|${phoneHash ?? "none"}`), 3600, L.activatePairPerHour);
  const failKeys = [keyOf(d, `${scope}fail`, "email", email)];
  if (phoneHash) failKeys.push(keyOf(d, `${scope}fail`, "phone", phoneHash));
  for (const k of failKeys) await assertFailBudget(d, k, L.activateFailWindowSeconds, L.activateFailsPerEmail);
  return { email, phoneHash, failKeys };
}

const failProof = async (d: AuthDeps, p: Proof): Promise<never> => {
  for (const k of p.failKeys) await recordFail(d, k, L.activateFailWindowSeconds);
  throw new ApiError("ACTIVATION_FAILED", ACTIVATION_FAILED);
};

/**
 * POST /auth/activate. Creates the account in one step: email and phone must match a paid order that the server
 * already verified with Scalev. The password is hashed before the database is asked, so a refusal costs the same
 * time as a success. One entitlement activates once.
 */
export async function activate(
  d: AuthDeps,
  input: { email: string; phone: string; password: string; deviceLabel?: string },
  caller: Caller,
): Promise<SignInOutcome> {
  const proof = await proveWithLimits(d, "act", input, caller);
  assertPolicy(input.password, { email: proof.email, phone: input.phone });
  const passwordHash = await hashPassword(input.password, d.cfg.scrypt);
  const res = await d.db.asService((q) =>
    one<{ ok: boolean; user_id?: string }>(
      q,
      "app_private.activate_account($1, $2, $3, $4, $5::timestamptz)",
      [proof.email, proof.phoneHash, passwordHash, ipHashOf(d, caller), d.now().toISOString()],
    ),
  );
  if (!res.ok || !res.user_id) return failProof(d, proof);
  return startSignIn(d, res.user_id, proof.email, input.deviceLabel, caller);
}

/**
 * POST /auth/reset-password. Same proof as activation, for an account that has a password. It signs every device
 * out and opens no session: the buyer signs in again by hand.
 */
export async function resetPasswordSelf(
  d: AuthDeps,
  input: { email: string; phone: string; newPassword: string },
  caller: Caller,
): Promise<void> {
  const proof = await proveWithLimits(d, "rst", input, caller);
  assertPolicy(input.newPassword, { email: proof.email, phone: input.phone });
  const passwordHash = await hashPassword(input.newPassword, d.cfg.scrypt);
  const res = await d.db.asService((q) =>
    one<{ ok: boolean }>(q, "app_private.reset_password_self($1, $2, $3, $4, $5::timestamptz)", [
      proof.email,
      proof.phoneHash,
      passwordHash,
      ipHashOf(d, caller),
      d.now().toISOString(),
    ]),
  );
  if (!res.ok) await failProof(d, proof);
}

/** POST /auth/set-password. Only for a reset link an admin made. The link works once and then expires. */
export async function setPasswordWithToken(
  d: AuthDeps,
  input: { token: string; password: string; deviceLabel?: string },
  caller: Caller,
): Promise<SignInOutcome> {
  await hit(d, keyOf(d, "tok", "ip", caller.ip), 600, L.tokenIpPer10Min);
  const tokenHash = hmacHex(d.cfg.pepper, "pwtoken", input.token);
  await hit(d, `tok:token:${tokenHash}`, 3600, L.tokenPerHour);
  assertPolicy(input.password);
  const passwordHash = await hashPassword(input.password, d.cfg.scrypt);
  const res = await d.db.asService((q) =>
    one<{ ok: boolean; user_id?: string }>(q, "app_private.password_token_consume($1, $2, $3, $4::timestamptz)", [
      tokenHash,
      passwordHash,
      ipHashOf(d, caller),
      d.now().toISOString(),
    ]),
  );
  if (!res.ok || !res.user_id) throw new ApiError("INVALID_TOKEN", BAD_TOKEN);
  const email = await d.db.asService((q) =>
    one<string>(q, "(select p.email_normalized from public.profiles p where p.user_id = $1::uuid)", [res.user_id]),
  );
  return startSignIn(d, res.user_id, email, input.deviceLabel, caller);
}

/** POST /me/password. Needs the current password. Every other device is signed out. */
export async function changePassword(
  d: AuthDeps,
  user: AuthedUser,
  input: { currentPassword: string; newPassword: string },
  caller: Caller,
): Promise<void> {
  const failKey = keyOf(d, "chpwfail", "user", user.userId);
  await assertFailBudget(d, failKey, 900, L.changePasswordFailsPer15Min);
  const cred = await d.db.asService((q) =>
    one<{ user_id: string; password_hash: string } | null>(q, "app_private.credential_for_login($1)", [user.email]),
  );
  const stored = cred?.user_id === user.userId ? cred.password_hash : await dummyHash(d.cfg.scrypt);
  const ok = await verifyPassword(input.currentPassword, stored);
  if (!ok || cred?.user_id !== user.userId) {
    await recordFail(d, failKey, 900);
    throw new ApiError("INVALID_CREDENTIALS", "Password lama belum benar.");
  }
  assertPolicy(input.newPassword, { email: user.email });
  const passwordHash = await hashPassword(input.newPassword, d.cfg.scrypt);
  await d.db.asService((q) =>
    q.query("select app_private.password_change($1::uuid, $2, $3::uuid, $4, $5::timestamptz)", [
      user.userId,
      passwordHash,
      user.deviceId,
      ipHashOf(d, caller),
      d.now().toISOString(),
    ]),
  );
}

/** POST /auth/complete-pending-login. Removes one device, then signs in. The token works once. */
export async function completePendingLogin(
  d: AuthDeps,
  input: { pendingToken: string; revokeDeviceId: string; deviceLabel?: string },
  caller: Caller,
): Promise<{ body: SignInResponse; cookie: string }> {
  await hit(d, keyOf(d, "pend", "ip", caller.ip), 600, L.loginIpPer10Min);
  if (!UUID_RE.test(input.revokeDeviceId)) throw new ApiError("NOT_FOUND", "Perangkat tidak ditemukan.");
  const now = d.now();
  const secret = newSecret();
  const r = await d.db.asService((q) =>
    one<StartResult>(q, "app_private.complete_pending_login($1, $2::uuid, $3, $4, $5::timestamptz)", [
      hmacHex(d.cfg.pepper, "pending", input.pendingToken),
      input.revokeDeviceId,
      cleanLabel(input.deviceLabel),
      hmacHex(d.cfg.pepper, "session", secret),
      now.toISOString(),
    ]),
  );
  if (r.status !== "ok" || !r.user_id) throw new ApiError("PENDING_LOGIN_INVALID", "Masuk lagi dengan password.");
  const email = await d.db.asService((q) =>
    one<string>(q, "(select p.email_normalized from public.profiles p where p.user_id = $1::uuid)", [r.user_id]),
  );
  return {
    body: {
      user: { id: r.user_id, email },
      device_id: r.device_id!,
      expires_at: r.expires_at!,
      access: await accessOf(d, r.user_id),
    },
    cookie: sessionCookie(r.device_id!, secret, new Date(r.expires_at!), now, caller.secure),
  };
}

/** What the cookie on this request means right now. Never throws for a bad cookie, it just is not a session. */
export async function resolveSession(d: AuthDeps, req: Request): Promise<SessionState> {
  const parsed = parseSessionCookie(req.headers.get("cookie"));
  if (!parsed) return { state: "none" };
  const r = await d.db.asService((q) =>
    one<{ state: string; user_id?: string; email?: string; device_id?: string; expires_at?: string }>(
      q,
      "app_private.resolve_session($1::uuid, $2, $3::timestamptz)",
      [parsed.deviceId, hmacHex(d.cfg.pepper, "session", parsed.secret), d.now().toISOString()],
    ),
  );
  if (r.state === "ok") {
    return {
      state: "ok",
      user: { userId: r.user_id!, email: r.email ?? "", deviceId: r.device_id!, expiresAt: r.expires_at! },
    };
  }
  return { state: r.state === "expired" || r.state === "revoked" ? r.state : "none" };
}

export function authSessionBody(s: SessionState): AuthSession {
  if (s.state === "ok") {
    return {
      authenticated: true,
      reason: null,
      user: { id: s.user.userId, email: s.user.email },
      device_id: s.user.deviceId,
      expires_at: s.user.expiresAt,
    };
  }
  return { authenticated: false, reason: s.state, user: null, device_id: null, expires_at: null };
}

/** Same cookie, new Max-Age, so an active device keeps its 30 days. */
export function refreshedCookie(d: AuthDeps, req: Request, user: AuthedUser, secure: boolean): string | null {
  const parsed = parseSessionCookie(req.headers.get("cookie"));
  return parsed ? sessionCookie(user.deviceId, parsed.secret, new Date(user.expiresAt), d.now(), secure) : null;
}

export async function logout(d: AuthDeps, user: AuthedUser, secure: boolean): Promise<string> {
  await d.db.asService((q) =>
    q.query("select app_private.logout_device($1::uuid, $2::uuid, $3::timestamptz)", [
      user.userId,
      user.deviceId,
      d.now().toISOString(),
    ]),
  );
  return clearSessionCookie(secure);
}

export async function listDevices(d: AuthDeps, user: AuthedUser): Promise<Device[]> {
  return d.db.asService((q) =>
    one<Device[]>(q, "app_private.devices_json($1::uuid, $2::uuid)", [user.userId, user.deviceId]),
  );
}

export async function revokeDevice(d: AuthDeps, user: AuthedUser, target: string): Promise<void> {
  if (!UUID_RE.test(target)) throw new ApiError("NOT_FOUND", "Perangkat tidak ditemukan.");
  await d.db.asService((q) =>
    q.query("select app_private.revoke_device($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)", [
      user.userId,
      user.deviceId,
      target,
      d.now().toISOString(),
    ]),
  );
}
