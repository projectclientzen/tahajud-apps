import { openDB } from "idb";
import { PENDING_LOGIN_TTL_MS, checkDeviceLimit, checkPendingLogin, type PendingLogin } from "@/domain/auth/devices";
import { isPlausibleEmail, normalizeEmail } from "@/domain/auth/email";
import { normalizePhone } from "@/domain/auth/phone";
import { PASSWORD_PROBLEM_MESSAGE, checkPassword, normalizePassword } from "@/domain/auth/password-policy";
import { addAttempt, isThrottled } from "@/domain/auth/throttle";
import { PROVISIONAL_AUTH } from "@/domain/config/provisional";
import {
  ApiError,
  activateRequestSchema,
  loginRequestSchema,
  type Access,
  type AuthSession,
  type Device,
  type SignInResponse,
  type SignInResult,
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

/** DEMO order: the email and phone a buyer used at checkout. The phone is stored normalized, as `628...`. */
export interface DemoOrder {
  phone: string;
}

/** DEMO account. The hash is SHA-256 for the demo only: it never protects anything real. */
export interface DemoAccount {
  userId: string;
  passwordHash: string;
}

/** What the mock auth "server" remembers. Not per user: it exists before anyone is signed in. */
export interface AuthState {
  schemaVersion: 2;
  scenario: AuthScenarioName;
  /** Paid demo orders by email. Activation needs email AND phone to match one of them. */
  orders: Record<string, DemoOrder>;
  accounts: Record<string, DemoAccount>;
  /** Failed attempts by key (`login:<email>`, `act:<email>`, `act:phone:<digits>`), as times. */
  fails: Record<string, number[]>;
  /** Admin reset links made in the dev tools. Token -> account. */
  resetTokens: Record<string, { email: string; expiresAt: number; used: boolean }>;
  entitlements: Record<string, EntitlementStatus>;
  session: MockSession | null;
  signedOutReason: "none" | "expired" | "revoked";
  devices: Record<string, DeviceRecord[]>;
  /** Right password but 3 devices active (PRD §24.1). Token -> who is waiting. */
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

const BAD_LOGIN = "Email atau password salah.";
const ACTIVATION_FAILED = "Data tidak cocok atau akun sudah aktif. Coba masuk, atau hubungi CS.";
const TOO_MANY = "Terlalu sering mencoba. Coba lagi sebentar.";
const FAIL_WINDOW_MS = 15 * 60_000;

/** Demo hashing only. Real hashing is scrypt on the server (src/server/auth/password.ts). */
async function demoHash(password: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`tt-demo-only:${normalizePassword(password)}`),
  );
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const cryptoInt = (max: number): number => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! % max;
};

/** Mock of the sign-in endpoints. Rules come from src/domain/auth. Simulated: nothing is emailed. */
export class MockAuth implements AuthRepository {
  private state: AuthState | null = null;
  private loading: Promise<AuthState> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private epoch = 0;
  private readonly random: (max: number) => number;

  constructor(private readonly o: AuthOptions) {
    this.random = o.randomInt ?? cryptoInt;
  }

  private nowMs(): number {
    const c = this.state?.clockOverride;
    return c ? Date.parse(c) : this.o.clock.now().getTime();
  }

  /** One shared load: concurrent first calls must not each read storage and replace `this.state` under one another. */
  private s(): Promise<AuthState> {
    if (this.state) return Promise.resolve(this.state);
    this.loading ??= this.readInitial().catch((err: unknown) => {
      this.loading = null;
      throw err;
    });
    return this.loading;
  }

  private async readInitial(): Promise<AuthState> {
    const epoch = this.epoch;
    const stored = await this.o.storage.load();
    if (epoch !== this.epoch) return this.s();
    // Saved state from before the email + password change (OTP era) is dropped: it has no accounts or orders.
    const usable = stored && stored.schemaVersion === 2 ? stored : null;
    const st = usable ?? buildAuthScenario(this.o.scenario ?? "logged_out", this.o.clock.now().getTime());
    st.pendingLogins ??= {};
    this.state = st;
    await this.save();
    return st;
  }

  /** Writes reach storage in the order they were requested. */
  private save = (): Promise<void> => {
    const write = async () => {
      if (this.state) await this.o.storage.save(this.state);
    };
    const next = this.writes.then(write, write);
    this.writes = next.catch(() => undefined);
    return next;
  };

  /** Opens a session, or answers with the device limit when 3 devices are already active. */
  private async signIn(
    st: AuthState,
    userId: string,
    email: string,
    deviceLabel: string,
    now: number,
  ): Promise<SignInResult> {
    const active = (st.devices[userId] ?? []).filter((d) => d.revokedAt === null);
    const limit = checkDeviceLimit(active);
    if (!limit.ok) {
      // The password was right. The person may remove one device and continue.
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

  private throttled(st: AuthState, keys: string[], limit: number, now: number): boolean {
    return keys.some((k) => isThrottled(st.fails[k] ?? [], now, FAIL_WINDOW_MS, limit));
  }
  private recordFails(st: AuthState, keys: string[], now: number): void {
    for (const k of keys) st.fails[k] = addAttempt(st.fails[k] ?? [], now, FAIL_WINDOW_MS);
  }

  async login(rawEmail: string, password: string, deviceLabel = "Perangkat baru"): Promise<SignInResult> {
    const req = loginRequestSchema.safeParse({ email: rawEmail, password });
    if (!req.success) throw new ApiError("INVALID_CREDENTIALS", BAD_LOGIN);
    const st = await this.s();
    const email = normalizeEmail(req.data.email);
    const now = this.nowMs();
    const key = [`login:${email}`];
    if (this.throttled(st, key, PROVISIONAL_AUTH.limits.loginFailsPerEmail, now)) {
      throw new ApiError("RATE_LIMITED", TOO_MANY, { retry_after_seconds: 900 });
    }
    const acct = st.accounts[email];
    // Same work for a missing account and a wrong password.
    const hash = await demoHash(password);
    if (!acct || acct.passwordHash !== hash) {
      this.recordFails(st, key, now);
      await this.save();
      throw new ApiError("INVALID_CREDENTIALS", BAD_LOGIN);
    }
    return this.signIn(st, acct.userId, email, deviceLabel, now);
  }

  /** Demo of activation: email + phone of a paid demo order, then a new password, in one request. */
  async activate(input: {
    email: string;
    phone: string;
    password: string;
    deviceLabel?: string;
  }): Promise<SignInResult> {
    const req = activateRequestSchema.safeParse({ email: input.email, phone: input.phone, password: input.password });
    if (!req.success || !isPlausibleEmail(req.data.email)) {
      throw new ApiError("VALIDATION_ERROR", "Data yang dikirim belum sesuai.");
    }
    const st = await this.s();
    const email = normalizeEmail(req.data.email);
    const phone = normalizePhone(req.data.phone);
    const now = this.nowMs();
    const keys = [`act:${email}`, ...(phone ? [`act:phone:${phone}`] : [])];
    if (this.throttled(st, keys, PROVISIONAL_AUTH.limits.activateFailsPerEmail, now)) {
      throw new ApiError("RATE_LIMITED", TOO_MANY, { retry_after_seconds: 900 });
    }
    const problem = checkPassword(req.data.password, { email, phone: req.data.phone });
    if (problem) throw new ApiError("WEAK_PASSWORD", PASSWORD_PROBLEM_MESSAGE[problem], { reason: problem });
    const order = st.orders[email];
    const paid = st.entitlements[email] === "active";
    if (!order || !phone || order.phone !== phone || !paid || st.accounts[email]) {
      this.recordFails(st, keys, now);
      await this.save();
      throw new ApiError("ACTIVATION_FAILED", ACTIVATION_FAILED);
    }
    const userId = userIdFor(email);
    st.accounts[email] = { userId, passwordHash: await demoHash(req.data.password) };
    return this.signIn(st, userId, email, input.deviceLabel ?? "Perangkat baru", now);
  }

  /** Demo of the buyer's own reset: same proof, then a new password. Signs every device out, opens no session. */
  async resetPassword(input: { email: string; phone: string; newPassword: string }): Promise<void> {
    if (!isPlausibleEmail(input.email)) throw new ApiError("VALIDATION_ERROR", "Format email belum benar.");
    const st = await this.s();
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    const now = this.nowMs();
    const keys = [`rst:${email}`, ...(phone ? [`rst:phone:${phone}`] : [])];
    if (this.throttled(st, keys, PROVISIONAL_AUTH.limits.activateFailsPerEmail, now)) {
      throw new ApiError("RATE_LIMITED", TOO_MANY, { retry_after_seconds: 900 });
    }
    const problem = checkPassword(input.newPassword, { email, phone: input.phone });
    if (problem) throw new ApiError("WEAK_PASSWORD", PASSWORD_PROBLEM_MESSAGE[problem], { reason: problem });
    const acct = st.accounts[email];
    const order = st.orders[email];
    if (!acct || !order || !phone || order.phone !== phone) {
      this.recordFails(st, keys, now);
      await this.save();
      throw new ApiError("ACTIVATION_FAILED", ACTIVATION_FAILED);
    }
    acct.passwordHash = await demoHash(input.newPassword);
    this.revokeAllDevices(st, acct.userId, now);
    await this.save();
  }

  /** Demo of an admin reset link (made in the dev tools). Works once, expires, signs in on success. */
  async setPasswordWithToken(token: string, password: string, deviceLabel = "Perangkat baru"): Promise<SignInResult> {
    const st = await this.s();
    const now = this.nowMs();
    const problem = checkPassword(password);
    if (problem) throw new ApiError("WEAK_PASSWORD", PASSWORD_PROBLEM_MESSAGE[problem], { reason: problem });
    const t = st.resetTokens[token];
    if (!t || t.used || t.expiresAt <= now || !st.accounts[t.email]) {
      throw new ApiError("INVALID_TOKEN", "Tautan tidak berlaku atau sudah dipakai. Minta tautan baru ke CS.");
    }
    t.used = true;
    const acct = st.accounts[t.email]!;
    acct.passwordHash = await demoHash(password);
    this.revokeAllDevices(st, acct.userId, now);
    return this.signIn(st, acct.userId, t.email, deviceLabel, now);
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const { st, ses } = await this.requireSession();
    const now = this.nowMs();
    const key = [`chpw:${ses.userId}`];
    if (this.throttled(st, key, PROVISIONAL_AUTH.limits.changePasswordFailsPer15Min, now)) {
      throw new ApiError("RATE_LIMITED", TOO_MANY, { retry_after_seconds: 900 });
    }
    const acct = st.accounts[ses.email];
    if (!acct || acct.passwordHash !== (await demoHash(currentPassword))) {
      this.recordFails(st, key, now);
      await this.save();
      throw new ApiError("INVALID_CREDENTIALS", "Password lama belum benar.");
    }
    const problem = checkPassword(newPassword, { email: ses.email });
    if (problem) throw new ApiError("WEAK_PASSWORD", PASSWORD_PROBLEM_MESSAGE[problem], { reason: problem });
    acct.passwordHash = await demoHash(newPassword);
    for (const d of st.devices[ses.userId] ?? []) if (d.id !== ses.deviceId && d.revokedAt === null) d.revokedAt = now;
    await this.save();
  }

  private revokeAllDevices(st: AuthState, userId: string, now: number): void {
    for (const d of st.devices[userId] ?? []) if (d.revokedAt === null) d.revokedAt = now;
    if (st.session?.userId === userId) st.signedOutReason = "revoked";
  }

  /** Second step of a 4th-device login. Removes the chosen device, then signs in. The token works once. */
  async completePendingLogin(
    token: string,
    revokeDeviceId: string,
    deviceLabel = "Perangkat baru",
  ): Promise<SignInResponse> {
    const st = await this.s();
    const now = this.nowMs();
    const pending = st.pendingLogins?.[token];
    const check = checkPendingLogin(pending, now);
    if (!check.ok || !pending) {
      throw new ApiError("PENDING_LOGIN_INVALID", "Waktu untuk melanjutkan sudah habis. Masuk lagi dengan password.");
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
  ): Promise<SignInResponse> {
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
  /** Makes an admin reset link for a demo account, like CS would. Returns the token for `/reset#t=<token>`. */
  async dev_issueResetToken(email: string): Promise<string | null> {
    const st = await this.s();
    const e = normalizeEmail(email);
    if (!st.accounts[e]) return null;
    const token = `demo_${this.random(10 ** 9).toString(36)}${this.random(10 ** 9).toString(36)}${this.random(10 ** 9).toString(36)}`;
    for (const t of Object.values(st.resetTokens)) if (t.email === e && !t.used) t.used = true;
    st.resetTokens[token] = { email: e, expiresAt: this.nowMs() + PROVISIONAL_AUTH.adminResetTokenMinutes * 60_000, used: false };
    await this.save();
    return token;
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
    this.epoch++;
    this.loading = null;
    this.state = buildAuthScenario(name, keep ? Date.parse(keep) : this.o.clock.now().getTime());
    this.state.clockOverride = keep;
    await this.save();
  }
  async dev_reset(): Promise<void> {
    this.epoch++;
    this.loading = null;
    this.state = null;
    await this.o.storage.clear();
  }
}

export { AUTH_SCENARIOS, type AuthScenarioName };
