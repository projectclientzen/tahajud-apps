import { openDB } from "idb";
import { PENDING_LOGIN_TTL_MS, checkDeviceLimit, checkPendingLogin, type PendingLogin } from "@/domain/auth/devices";
import { isPlausibleEmail, normalizeEmail } from "@/domain/auth/email";
import {
  OTP_RULES,
  checkOtp,
  decideOtpRequest,
  generateOtp,
  isValidOtpFormat,
  newOtpRecord,
  type OtpRecord,
} from "@/domain/auth/otp";
import { PROVISIONAL_AUTH } from "@/domain/config/provisional";
import {
  ApiError,
  requestOtpRequestSchema,
  verifyOtpRequestSchema,
  type Access,
  type AuthSession,
  type Device,
  type RequestOtpResponse,
  type VerifyOtpResponse,
  type VerifyOtpResult,
} from "../contracts";
import type { AuthRepository } from "../repositories";
import type { Clock } from "./engine";
import { AUTH_SCENARIOS, buildAuthScenario, userIdFor, type AuthScenarioName } from "./fixtures/auth";

export type EntitlementStatus = "active" | "pending_verification" | "suspended" | "none";

export interface DeviceRecord {
  id: string;
  label: string;
  lastSeenAt: number;
  revokedAt: number | null;
}

export interface MockSession {
  userId: string;
  email: string;
  deviceId: string;
  issuedAt: number;
  expiresAt: number;
}

/** What the mock auth "server" remembers. Not per user: it exists before anyone is signed in. */
export interface AuthState {
  schemaVersion: 1;
  scenario: AuthScenarioName;
  otps: Record<string, OtpRecord>;
  sentAt: Record<string, number[]>;
  /** Dev tools only. A real server emails the code; the production UI never shows it. */
  outbox: { to: string; code: string; sentAt: number }[];
  entitlements: Record<string, EntitlementStatus>;
  session: MockSession | null;
  signedOutReason: "none" | "expired" | "revoked";
  devices: Record<string, DeviceRecord[]>;
  /** Right code but 3 devices active (PRD §24.1). Token -> who is waiting. Absent in older saved states. */
  pendingLogins?: Record<string, PendingLogin>;
  clockOverride: string | null;
}

export interface AuthStorage {
  load(): Promise<AuthState | null>;
  save(s: AuthState): Promise<void>;
  clear(): Promise<void>;
}

export function memoryAuthStorage(): AuthStorage {
  let s: AuthState | null = null;
  return {
    load: async () => (s ? structuredClone(s) : null),
    save: async (x) => {
      s = structuredClone(x);
    },
    clear: async () => {
      s = null;
    },
  };
}

export function idbAuthStorage(): AuthStorage {
  const db = () => openDB("tahajud-auth-mock", 1, { upgrade: (d) => void d.createObjectStore("state") });
  return {
    load: async () => ((await (await db()).get("state", "auth")) as AuthState | undefined) ?? null,
    save: async (x) => void (await (await db()).put("state", x, "auth")),
    clear: async () => void (await (await db()).delete("state", "auth")),
  };
}

export interface AuthOptions {
  clock: Clock;
  storage: AuthStorage;
  scenario?: AuthScenarioName;
  /** Integer in [0, max). Defaults to crypto. Tests inject a fixed value. */
  randomInt?: (max: number) => number;
  /** Lets the app say whether this user finished onboarding. Defaults to false. */
  onboardingCompleted?: (userId: string) => Promise<boolean>;
}

const GENERIC_SENT = "Jika email ini punya akses, kode 6 digit sudah dikirim. Cek juga folder spam.";
const BAD_CODE = "Kode tidak valid atau sudah kedaluwarsa.";

const cryptoInt = (max: number): number => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! % max;
};

/** Mock of the sign-in endpoints. Rules come from src/domain/auth. Simulated: nothing is emailed. */
export class MockAuth implements AuthRepository {
  private state: AuthState | null = null;
  private readonly random: (max: number) => number;

  constructor(private readonly o: AuthOptions) {
    this.random = o.randomInt ?? cryptoInt;
  }

  private nowMs(): number {
    const c = this.state?.clockOverride;
    return c ? Date.parse(c) : this.o.clock.now().getTime();
  }

  private async s(): Promise<AuthState> {
    if (!this.state) {
      this.state =
        (await this.o.storage.load()) ??
        buildAuthScenario(this.o.scenario ?? "logged_out", this.o.clock.now().getTime());
      this.state.pendingLogins ??= {};
      await this.o.storage.save(this.state);
    }
    return this.state;
  }

  private save = async (): Promise<void> => {
    if (this.state) await this.o.storage.save(this.state);
  };

  async requestOtp(raw: string): Promise<RequestOtpResponse> {
    const { email: input } = requestOtpRequestSchema.parse({ email: raw });
    if (!isPlausibleEmail(input)) throw new ApiError("VALIDATION_ERROR", "Format email belum benar.");
    const st = await this.s();
    const email = normalizeEmail(input);
    const now = this.nowMs();
    const d = decideOtpRequest(st.sentAt[email] ?? [], now);
    if (!d.ok) {
      throw new ApiError("RATE_LIMITED", "Terlalu sering meminta kode. Coba lagi sebentar.", {
        reason: d.reason,
        retry_after_seconds: d.retryAfterSeconds,
      });
    }
    // Same path for every email: the answer below never depends on entitlement.
    const code = generateOtp(this.random);
    st.otps[email] = newOtpRecord(code, now);
    st.sentAt[email] = [...(st.sentAt[email] ?? []).filter((t) => now - t < OTP_RULES.windowMs), now];
    st.outbox.push({ to: email, code, sentAt: now });
    await this.save();
    return { ok: true, message: GENERIC_SENT, resend_after_seconds: OTP_RULES.resendCooldownMs / 1000 };
  }

  async verifyOtp(raw: string, code: string, deviceLabel = "Perangkat baru"): Promise<VerifyOtpResult> {
    const req = verifyOtpRequestSchema.safeParse({ email: raw, code });
    if (!req.success || !isValidOtpFormat(code)) throw new ApiError("INVALID_OTP", BAD_CODE);
    const st = await this.s();
    const email = normalizeEmail(req.data.email);
    const now = this.nowMs();
    const r = checkOtp(st.otps[email] ?? null, code, now);
    if (!r.ok) {
      if (r.record) st.otps[email] = r.record;
      await this.save();
      throw new ApiError("INVALID_OTP", BAD_CODE); // one message for wrong, expired, and locked codes
    }
    st.otps[email] = r.record;

    const userId = userIdFor(email);
    const active = (st.devices[userId] ?? []).filter((d) => d.revokedAt === null);
    const limit = checkDeviceLimit(active);
    if (!limit.ok) {
      // The code was right, so the person owns the mailbox. They may remove one device and continue.
      const token = this.newToken();
      const pending = (st.pendingLogins ??= {});
      pending[token] = { email, userId, createdAt: now, used: false };
      await this.save();
      return {
        status: "device_limit",
        max_devices: limit.max,
        pending_token: token,
        pending_expires_at: new Date(now + PENDING_LOGIN_TTL_MS).toISOString(),
        devices: [...active]
          .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
          .map((d) => ({
            id: d.id,
            label: d.label,
            last_seen_at: new Date(d.lastSeenAt).toISOString(),
            is_current: false,
          })),
      };
    }
    return { status: "ok", ...(await this.startSession(st, userId, email, deviceLabel, now)) };
  }

  /** Second step of a 4th-device login. Removes the chosen device, then signs in. The token works once. */
  async completePendingLogin(
    token: string,
    revokeDeviceId: string,
    deviceLabel = "Perangkat baru",
  ): Promise<VerifyOtpResponse> {
    const st = await this.s();
    const now = this.nowMs();
    const pending = st.pendingLogins?.[token];
    const check = checkPendingLogin(pending, now);
    if (!check.ok || !pending) {
      throw new ApiError("PENDING_LOGIN_INVALID", "Waktu untuk melanjutkan sudah habis. Masuk lagi dengan kode baru.");
    }
    const dev = st.devices[pending.userId]?.find((d) => d.id === revokeDeviceId && d.revokedAt === null);
    if (!dev) throw new ApiError("NOT_FOUND", "Perangkat tidak ditemukan.");
    dev.revokedAt = now;
    pending.used = true;
    return this.startSession(st, pending.userId, pending.email, deviceLabel, now);
  }

  private newToken(): string {
    return `pl_${this.random(10 ** 9).toString(36)}${this.random(10 ** 9).toString(36)}${this.random(10 ** 9).toString(36)}`;
  }

  private async startSession(
    st: AuthState,
    userId: string,
    email: string,
    deviceLabel: string,
    now: number,
  ): Promise<VerifyOtpResponse> {
    const list = st.devices[userId] ?? [];
    const deviceId = `dev_${userId}_${list.length + 1}`;
    list.push({ id: deviceId, label: deviceLabel, lastSeenAt: now, revokedAt: null });
    st.devices[userId] = list;

    const expiresAt = now + PROVISIONAL_AUTH.sessionDays * 86_400_000;
    st.session = { userId, email, deviceId, issuedAt: now, expiresAt };
    st.signedOutReason = "none";
    await this.save();
    return {
      user: { id: userId, email },
      device_id: deviceId,
      expires_at: new Date(expiresAt).toISOString(),
      access: await this.accessFor(st, userId, email),
    };
  }

  private async accessFor(st: AuthState, userId: string, email: string): Promise<Access> {
    const status = st.entitlements[email] ?? "none";
    return {
      authenticated: true,
      access_status:
        status === "active"
          ? "active"
          : status === "pending_verification"
            ? "awaiting_order_verification"
            : status === "suspended"
              ? "suspended"
              : "none",
      entitlement_type: status === "active" ? "lifetime" : null,
      expires_at: null,
      onboarding_completed: status === "active" ? ((await this.o.onboardingCompleted?.(userId)) ?? false) : false,
    };
  }

  /** The session if it is still good. Expired and revoked sessions read as signed out, with the reason. */
  async getSession(): Promise<AuthSession> {
    const st = await this.s();
    const ses = st.session;
    const out = (reason: "none" | "expired" | "revoked"): AuthSession => ({
      authenticated: false,
      reason,
      user: null,
      device_id: null,
      expires_at: null,
    });
    if (!ses) return out(st.signedOutReason);
    if (this.nowMs() >= ses.expiresAt) return out("expired");
    const dev = st.devices[ses.userId]?.find((d) => d.id === ses.deviceId);
    if (dev?.revokedAt) return out("revoked");
    if (dev) {
      dev.lastSeenAt = this.nowMs();
      await this.save();
    }
    return {
      authenticated: true,
      reason: null,
      user: { id: ses.userId, email: ses.email },
      device_id: ses.deviceId,
      expires_at: new Date(ses.expiresAt).toISOString(),
    };
  }

  private async requireSession(): Promise<{ st: AuthState; ses: MockSession }> {
    const s = await this.getSession();
    const st = await this.s();
    if (!s.authenticated || !st.session) throw new ApiError("UNAUTHENTICATED", "Masuk dulu untuk melanjutkan.");
    return { st, ses: st.session };
  }

  async logout(): Promise<void> {
    const st = await this.s();
    const ses = st.session;
    if (ses) {
      const dev = st.devices[ses.userId]?.find((d) => d.id === ses.deviceId);
      if (dev) dev.revokedAt = this.nowMs();
    }
    st.session = null;
    st.signedOutReason = "none";
    await this.save();
  }

  async listDevices(): Promise<Device[]> {
    const { st, ses } = await this.requireSession();
    return (st.devices[ses.userId] ?? [])
      .filter((d) => d.revokedAt === null)
      .map((d) => ({
        id: d.id,
        label: d.label,
        last_seen_at: new Date(d.lastSeenAt).toISOString(),
        is_current: d.id === ses.deviceId,
      }));
  }

  async revokeDevice(id: string): Promise<void> {
    const { st, ses } = await this.requireSession();
    if (id === ses.deviceId)
      throw new ApiError("VALIDATION_ERROR", "Untuk keluar dari perangkat ini, pakai tombol keluar.");
    const dev = st.devices[ses.userId]?.find((d) => d.id === id && d.revokedAt === null);
    if (!dev) throw new ApiError("NOT_FOUND", "Perangkat tidak ditemukan.");
    dev.revokedAt = this.nowMs();
    await this.save();
  }

  // ---------- dev tools (never shown in production UI) ----------
  /** Latest code sent to this email, or null. Stands in for opening the email. */
  async dev_peekOtp(email: string): Promise<string | null> {
    const st = await this.s();
    return st.otps[normalizeEmail(email)]?.code ?? null;
  }
  async dev_outbox(): Promise<AuthState["outbox"]> {
    return structuredClone((await this.s()).outbox);
  }
  async dev_setNow(iso: string | null): Promise<void> {
    (await this.s()).clockOverride = iso;
    await this.save();
  }
  async dev_advance(ms: number): Promise<void> {
    await this.s();
    await this.dev_setNow(new Date(this.nowMs() + ms).toISOString());
  }
  async dev_setEntitlement(email: string, status: EntitlementStatus): Promise<void> {
    (await this.s()).entitlements[normalizeEmail(email)] = status;
    await this.save();
  }
  async dev_loadScenario(name: AuthScenarioName): Promise<void> {
    const keep = this.state?.clockOverride ?? null;
    this.state = buildAuthScenario(name, keep ? Date.parse(keep) : this.o.clock.now().getTime());
    this.state.clockOverride = keep;
    await this.save();
  }
  async dev_reset(): Promise<void> {
    this.state = null;
    await this.o.storage.clear();
  }
}

export { AUTH_SCENARIOS, type AuthScenarioName };
