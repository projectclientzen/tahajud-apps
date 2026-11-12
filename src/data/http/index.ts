import { z, type ZodType } from "zod";
import {
  ApiError,
  accessSchema,
  API_ERROR_CODES,
  authSessionSchema,
  calendarResponseSchema,
  counterOperationsResponseSchema,
  dashboardSchema,
  deviceLimitResponseSchema,
  deviceSchema,
  excuseResponseSchema,
  isoDate,
  levelProgressResponseSchema,
  levelSchema,
  nightSessionSchema,
  notificationPreferencesSchema,
  prayerTimeSchema,
  profileSchema,
  quranProgressListSchema,
  quranProgressSchema,
  regionSchema,
  reportResponseSchema,
  requestOtpResponseSchema,
  sessionHistoryResponseSchema,
  sessionSummarySchema,
  verifyOtpResponseSchema,
  wakePlanSchema,
  type ApiErrorCode,
} from "../contracts";
import type { AuthRepository, DataLayer } from "../repositories";

export interface HttpOptions {
  /** Defaults to "/api/v1" in the browser. Tests pass a full origin. */
  baseUrl?: string;
  /** Tests pass a function that calls the route handlers directly. */
  fetch?: typeof fetch;
}

const KNOWN = new Set<string>(API_ERROR_CODES);

function codeFromStatus(status: number): ApiErrorCode {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "ENTITLEMENT_INACTIVE";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "NOT_AVAILABLE";
  return "VALIDATION_ERROR";
}

/** One small client for /api/v1. Every answer is checked against the shared schema before the UI sees it. */
class Http {
  constructor(private readonly o: HttpOptions) {}

  async call<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, string | undefined>; schema?: ZodType<T> } = {},
  ): Promise<T> {
    const qs = Object.entries(opts.query ?? {})
      .filter((e): e is [string, string] => e[1] !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    const url = `${this.o.baseUrl ?? "/api/v1"}${path}${qs ? `?${qs}` : ""}`;
    let res: Response;
    try {
      res = await (this.o.fetch ?? fetch)(url, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: opts.body === undefined ? undefined : { "Content-Type": "application/json" },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch {
      // No connection. The offline queue treats this as "try again later".
      throw new ApiError("OFFLINE", "Tidak ada koneksi. Catatan disimpan di perangkat dan dikirim saat online.");
    }
    if (!res.ok) throw await this.errorOf(res);
    if (res.status === 204) return undefined as T;
    const json: unknown = await res.json().catch(() => undefined);
    if (!opts.schema) return json as T;
    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) throw new ApiError("NOT_AVAILABLE", "Jawaban server tidak dikenali. Coba lagi sebentar.");
    return parsed.data;
  }

  private async errorOf(res: Response): Promise<ApiError> {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    const e = body?.error;
    const code = e?.code && KNOWN.has(e.code) ? (e.code as ApiErrorCode) : codeFromStatus(res.status);
    return new ApiError(code, e?.message ?? "Terjadi gangguan. Coba lagi sebentar.", e?.details);
  }
}

const currentLevelSchema = z.object({ level: levelSchema, effective_from_session_key: isoDate.nullable() });
const okSchema = verifyOtpResponseSchema.extend({ status: z.literal("ok") });
const verifySchema = z.union([okSchema, deviceLimitResponseSchema]);

export function createHttpDataLayer(opts: HttpOptions = {}): DataLayer {
  const http = new Http(opts);
  const locate = (req: unknown) => http.call("PUT", "/me/location", { body: req, schema: prayerTimeSchema });
  return {
    mode: "live",
    access: { getAccess: () => http.call("GET", "/me/access", { schema: accessSchema }) },
    session: {
      getActiveSession: () => http.call("GET", "/me/night-session", { schema: nightSessionSchema.nullable() }),
      ensureActiveSession: () => http.call("POST", "/me/night-sessions", { body: {}, schema: nightSessionSchema }),
      getSession: (id) => http.call("GET", `/night-sessions/${encodeURIComponent(id)}`, { schema: nightSessionSchema }),
      setChecklist: (id, req) =>
        http.call("PUT", `/session-activities/${encodeURIComponent(id)}/status`, {
          body: req,
          schema: nightSessionSchema,
        }),
      applyCounterOperations: (id, req) =>
        http.call("POST", `/session-activities/${encodeURIComponent(id)}/counter-operations`, {
          body: req,
          schema: counterOperationsResponseSchema,
        }),
      getSummary: (id) =>
        http.call("GET", `/night-sessions/${encodeURIComponent(id)}/summary`, { schema: sessionSummarySchema }),
    },
    progress: {
      getCurrentLevel: () => http.call("GET", "/me/current-level", { schema: currentLevelSchema }),
      getLevelProgress: () => http.call("GET", "/me/level-progress", { schema: levelProgressResponseSchema }),
    },
    excuse: {
      addExcuse: (req) => http.call("POST", "/me/excuse", { body: req, schema: excuseResponseSchema }),
      cancelExcuse: (date) =>
        http.call("DELETE", `/me/excuse/${encodeURIComponent(date)}`, { schema: excuseResponseSchema }),
    },
    report: {
      getDashboard: () => http.call("GET", "/me/dashboard", { schema: dashboardSchema }),
      getReport: (period) =>
        http.call("GET", "/me/reports", { query: { period: String(period) }, schema: reportResponseSchema }),
      getCalendar: (from, to) =>
        http.call("GET", "/me/calendar", { query: { from, to }, schema: calendarResponseSchema }),
      getSessionHistory: () => http.call("GET", "/me/session-history", { schema: sessionHistoryResponseSchema }),
    },
    prayer: {
      listRegions: () => http.call("GET", "/regions", { schema: z.array(regionSchema) }),
      getNextFajr: () => http.call("GET", "/me/next-fajr", { schema: prayerTimeSchema }),
      getWakePlan: () => http.call("GET", "/me/wake-plan", { schema: wakePlanSchema }),
      setLocation: locate,
    },
    quran: {
      getProgress: async () =>
        (await http.call("GET", "/me/quran-progress", { schema: quranProgressListSchema })).progress,
      putProgress: (surah, req) =>
        http.call("PUT", `/me/quran-progress/${surah}`, { body: req, schema: quranProgressSchema }),
    },
    notifications: {
      getPreferences: () => http.call("GET", "/me/notification-preferences", { schema: notificationPreferencesSchema }),
      putPreferences: (prefs) =>
        http.call("PUT", "/me/notification-preferences", { body: prefs, schema: notificationPreferencesSchema }),
    },
    profile: {
      getProfile: () => http.call("GET", "/me/profile", { schema: profileSchema }),
      updateProfile: (patch) => http.call("PATCH", "/me/profile", { body: patch, schema: profileSchema }),
      setLocation: locate,
      completeOnboarding: () => http.call("POST", "/me/onboarding/complete", { body: {}, schema: profileSchema }),
      updatePreferences: (patch) => http.call("PUT", "/me/preferences", { body: patch, schema: profileSchema }),
    },
  };
}

export function createHttpAuthRepository(opts: HttpOptions = {}): AuthRepository {
  const http = new Http(opts);
  return {
    requestOtp: (email) =>
      http.call("POST", "/auth/request-otp", { body: { email }, schema: requestOtpResponseSchema }),
    verifyOtp: async (email, code, deviceLabel) => {
      const r = await http.call("POST", "/auth/verify-otp", {
        body: { email, code, device_label: deviceLabel },
        schema: verifySchema,
      });
      return r;
    },
    completePendingLogin: (pendingToken, revokeDeviceId, deviceLabel) =>
      http.call("POST", "/auth/complete-pending-login", {
        body: { pending_token: pendingToken, revoke_device_id: revokeDeviceId, device_label: deviceLabel },
        schema: verifyOtpResponseSchema,
      }),
    getSession: () => http.call("GET", "/me", { schema: authSessionSchema }),
    logout: async () => {
      await http.call("POST", "/auth/logout", { body: {} });
    },
    listDevices: async () =>
      (await http.call("GET", "/me/devices", { schema: z.object({ devices: z.array(deviceSchema) }) })).devices,
    revokeDevice: async (id) => {
      await http.call("DELETE", `/me/devices/${encodeURIComponent(id)}`);
    },
  };
}
