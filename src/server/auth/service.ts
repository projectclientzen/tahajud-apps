import { isPlausibleEmail, normalizeEmail } from "@/domain/auth/email";
import {
  ApiError,
  type Device,
  type DeviceLimitResponse,
  type Access,
  type AuthSession,
  type RequestOtpResponse,
  type VerifyOtpResponse,
} from "@/data/contracts";
import { one, UUID_RE, type Db } from "@/server/db";
import type { AuthConfig } from "./config";
import { clearSessionCookie, parseSessionCookie, sessionCookie } from "./cookie";
import { hmacHex, newSecret } from "./crypto";
import type { OtpProvider } from "./providers";

export interface AuthDeps {
  db: Db;
  now: () => Date;
  cfg: AuthConfig;
  provider: OtpProvider;
}

export interface AuthedUser {
  userId: string;
  email: string;
  deviceId: string;
  expiresAt: string;
}

export type SessionState = { state: "ok"; user: AuthedUser } | { state: "none" | "expired" | "revoked" };

const GENERIC_SENT = "Jika email ini punya akses, kode 6 digit sudah dikirim. Cek juga folder spam.";
const BAD_CODE = "Kode tidak valid atau sudah kedaluwarsa.";

/** What one request needs to know about its caller. The IP is hashed before it becomes a key. */
export interface Caller {
  ip: string;
  secure: boolean;
}

export function callerOf(req: Request): Caller {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || req.headers.get("x-real-ip") || "unknown";
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return { ip, secure: proto ? proto === "https" : new URL(req.url).protocol === "https:" };
}

async function ipLimit(d: AuthDeps, scope: string, ip: string, windowSeconds: number, limit: number): Promise<void> {
  const res = await d.db.asService((q) =>
    one<{ allowed: boolean; retry_after_seconds: number }>(q, "app_private.rate_hit($1, $2::timestamptz, $3, $4)", [
      `${scope}:ip:${hmacHex(d.cfg.pepper, "ip", ip)}`,
      d.now().toISOString(),
      windowSeconds,
      limit,
    ]),
  );
  if (!res.allowed) {
    throw new ApiError("RATE_LIMITED", "Terlalu sering mencoba. Coba lagi sebentar.", {
      reason: "ip_limit",
      retry_after_seconds: res.retry_after_seconds,
    });
  }
}

/** POST /auth/request-otp. Same answer for every email, registered or not (PRD §24.1, AUTH-06). */
export async function requestOtp(d: AuthDeps, rawEmail: string, caller: Caller): Promise<RequestOtpResponse> {
  if (!isPlausibleEmail(rawEmail)) throw new ApiError("VALIDATION_ERROR", "Format email belum benar.");
  const email = normalizeEmail(rawEmail);
  await ipLimit(d, "otp", caller.ip, 3600, 10);
  await d.provider.request(email, d.now());
  return { ok: true, message: GENERIC_SENT, resend_after_seconds: 60 };
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

export type VerifyOutcome =
  | { kind: "ok"; body: VerifyOtpResponse & { status: "ok" }; cookie: string }
  | { kind: "device_limit"; body: DeviceLimitResponse };

async function accessOf(d: AuthDeps, uid: string): Promise<Access> {
  return d.db.asUser(uid, (q) => one<Access>(q, "public.get_access()"));
}

/** POST /auth/verify-otp. A right code on a 4th device creates no session, only a 10 minute permission. */
export async function verifyOtp(
  d: AuthDeps,
  input: { email: string; code: string; deviceLabel?: string },
  caller: Caller,
): Promise<VerifyOutcome> {
  await ipLimit(d, "otpv", caller.ip, 600, 30);
  const email = normalizeEmail(input.email);
  const proven = await d.provider.verify(email, input.code, d.now());
  if (!proven) throw new ApiError("INVALID_OTP", BAD_CODE); // one message for wrong, expired, used and locked

  const now = d.now();
  const secret = newSecret();
  const pendingToken = newSecret();
  const label = cleanLabel(input.deviceLabel);
  const start = await d.db.asService(async (q) => {
    await q.query("select app_private.provision_user($1::uuid, $2, $3::timestamptz)", [
      proven.userId,
      email,
      now.toISOString(),
    ]);
    const r = await one<StartResult>(q, "app_private.start_device_session($1::uuid, $2, $3, $4::timestamptz)", [
      proven.userId,
      label,
      hmacHex(d.cfg.pepper, "session", secret),
      now.toISOString(),
    ]);
    if (r.status === "ok") return { start: r, pending: null };
    const pending = await one<{ pending_expires_at: string; devices: Device[] }>(
      q,
      "app_private.create_pending_login($1::uuid, $2, $3::timestamptz)",
      [proven.userId, hmacHex(d.cfg.pepper, "pending", pendingToken), now.toISOString()],
    );
    return { start: r, pending };
  });

  if (start.pending) {
    return {
      kind: "device_limit",
      body: {
        status: "device_limit",
        max_devices: start.start.max_devices ?? 3,
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
      user: { id: proven.userId, email },
      device_id: r.device_id!,
      expires_at: r.expires_at!,
      access: await accessOf(d, proven.userId),
    },
    cookie: sessionCookie(r.device_id!, secret, new Date(r.expires_at!), now, caller.secure),
  };
}

/** POST /auth/complete-pending-login. Removes one device, then signs in. The token works once. */
export async function completePendingLogin(
  d: AuthDeps,
  input: { pendingToken: string; revokeDeviceId: string; deviceLabel?: string },
  caller: Caller,
): Promise<{ body: VerifyOtpResponse; cookie: string }> {
  await ipLimit(d, "otpp", caller.ip, 600, 30);
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
  if (r.status !== "ok" || !r.user_id) throw new ApiError("PENDING_LOGIN_INVALID", "Masuk lagi dengan kode baru.");
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
