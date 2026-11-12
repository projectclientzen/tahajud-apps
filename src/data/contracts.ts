import { z } from "zod";

/**
 * Request and response shapes for /api/v1 (PRD v1.2 §19). Zod schemas are shared by the mock
 * repository, the future HTTP client, and the S5 route handlers. Field names follow the PRD (snake_case).
 */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const isoInstant = z.string().datetime({ offset: true });

export const sessionStatusSchema = z.enum(["completed", "partial", "missed", "excused", "upcoming"]);
export const levelSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const phaseSchema = z.enum(["night", "fajr", "post_fajr"]);

// ---- errors ----
export const API_ERROR_CODES = [
  "ENTITLEMENT_INACTIVE",
  "SESSION_LOCKED",
  "VERSION_CONFLICT",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "OFFLINE",
  "NOT_AVAILABLE",
  "RATE_LIMITED",
  "UNAUTHENTICATED",
  "INVALID_OTP",
  "PENDING_LOGIN_INVALID",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export const apiErrorSchema = z.object({
  error: z.object({ code: z.enum(API_ERROR_CODES), message: z.string(), details: z.unknown().optional() }),
});

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
  toJSON(): z.infer<typeof apiErrorSchema> {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

// ---- access (GET /me/access) ----
export const accessSchema = z.object({
  authenticated: z.boolean(),
  access_status: z.enum(["active", "awaiting_order_verification", "suspended", "none"]),
  entitlement_type: z.enum(["lifetime", "timed"]).nullable(),
  expires_at: isoInstant.nullable(),
  onboarding_completed: z.boolean(),
});
export type Access = z.infer<typeof accessSchema>;

// ---- prayer times (§19.3) ----
export const scheduleSourceSchema = z.enum(["provider", "cached", "manual"]);
export const prayerTimeSchema = z.object({
  available: z.boolean(),
  region_id: z.string().nullable(),
  region_name: z.string().nullable(),
  local_date: isoDate,
  timezone: z.string(),
  fajr_at: isoInstant.nullable(),
  maghrib_at: isoInstant.nullable(),
  source: scheduleSourceSchema.nullable(),
  cache_status: z.enum(["fresh", "cached", "none"]),
  fetched_at: isoInstant.nullable(),
  /** "Jadwal terkini" | "Jadwal tersimpan" | "Diatur manual" | null when unavailable. */
  label: z.string().nullable(),
  /** Mock mode only: "Jadwal contoh, bukan dari Kemenag". */
  demo_note: z.string().nullable(),
});
export type PrayerTime = z.infer<typeof prayerTimeSchema>;

export const locationUpdateSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("region"), region_id: z.string().min(1) }),
  z.object({
    mode: z.literal("manual"),
    timezone: z.string().min(1),
    fajr_time: z.string().regex(/^\d{2}:\d{2}$/),
    maghrib_time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
  }),
]);
export type LocationUpdate = z.infer<typeof locationUpdateSchema>;

export const regionSchema = z.object({ id: z.string(), name: z.string(), timezone: z.string() });
export type Region = z.infer<typeof regionSchema>;

export const wakePlanSchema = z.object({
  level: levelSchema,
  wake_at: isoInstant.nullable(),
  fajr_at: isoInstant.nullable(),
  duration_minutes: z.number().int(),
  buffer_minutes: z.number().int(),
  sleep_hours: z.number().nullable(),
  sleep_warning: z.string().nullable(),
  source: scheduleSourceSchema.nullable(),
});
export type WakePlan = z.infer<typeof wakePlanSchema>;

// ---- night session (§19.4) ----
export const sessionActivitySchema = z.object({
  id: z.string(),
  key: z.string(),
  phase: phaseSchema,
  type: z.enum(["prayer", "dhikr", "checklist", "quran"]),
  kind: z.enum(["counter", "checklist"]),
  title: z.string(),
  target: z.number().int().nullable(),
  unit: z.string().nullable(),
  required: z.boolean(),
  guidance: z.string().nullable(),
  /** Owner-supplied Arabic text, passed through unchanged. Null for non-dhikr items. */
  arabic_text: z.string().nullable(),
  dhikr_review_status: z.string().nullable(),
  count: z.number().int().min(0),
  checked: z.boolean(),
  /** Optimistic concurrency token for checklist updates. */
  version: z.number().int().min(0),
  completed: z.boolean(),
});
export type SessionActivity = z.infer<typeof sessionActivitySchema>;

export const nightSessionSchema = z.object({
  id: z.string(),
  session_key: isoDate,
  status: sessionStatusSchema,
  /** Finer state for the active-session UI. */
  state: z.enum(["scheduled", "in_progress", "completed", "partial", "missed", "excused"]),
  level: levelSchema,
  timezone: z.string(),
  region_id: z.string().nullable(),
  content_version: z.string(),
  created_at: isoInstant,
  cutoff_at: isoInstant,
  correction_deadline_at: isoInstant,
  correction_window_open: z.boolean(),
  activities: z.array(sessionActivitySchema),
});
export type NightSession = z.infer<typeof nightSessionSchema>;

export const checklistUpdateRequestSchema = z.object({ checked: z.boolean(), version: z.number().int().min(0) });
export type ChecklistUpdateRequest = z.infer<typeof checklistUpdateRequestSchema>;

export const counterOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("delta"),
    operation_id: z.string().min(1),
    delta: z.number().int().min(-1000).max(1000),
    client_recorded_at: isoInstant,
  }),
  z.object({ kind: z.literal("set_zero"), operation_id: z.string().min(1), client_recorded_at: isoInstant }),
]);
export const counterOperationsRequestSchema = z.object({ operations: z.array(counterOperationSchema).min(1).max(50) });
export type CounterOperationsRequest = z.infer<typeof counterOperationsRequestSchema>;

export const counterResultSchema = z.object({
  operation_id: z.string(),
  status: z.enum(["accepted", "duplicate", "rejected"]),
  authoritative_count: z.number().int().min(0),
  target: z.number().int(),
  completed: z.boolean(),
  updated_at: isoInstant,
  error_code: z.enum(["SESSION_LOCKED", "INVALID_DELTA", "ACTIVITY_NOT_FOUND"]).optional(),
});
export const counterOperationsResponseSchema = z.object({ results: z.array(counterResultSchema) });
export type CounterOperationsResponse = z.infer<typeof counterOperationsResponseSchema>;

export const sessionSummarySchema = z.object({
  session_id: z.string(),
  session_status: sessionStatusSchema,
  successful_nights_at_level: z.number().int(),
  required_successful_nights: z.number().int(),
  current_level: levelSchema,
  next_level_unlocked: z.boolean(),
  next_level_effective_session_key: isoDate.nullable(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const excuseRequestSchema = z.object({ from: isoDate, to: isoDate.optional() });
export type ExcuseRequest = z.infer<typeof excuseRequestSchema>;
export const excuseResponseSchema = z.object({ excused_dates: z.array(isoDate) });
export type ExcuseResponse = z.infer<typeof excuseResponseSchema>;

// ---- level progress (§19.4) ----
export const levelProgressSchema = z.object({
  level: levelSchema,
  completed: z.number().int(),
  required: z.number().int(),
  ratio: z.number(),
  unlocked: z.boolean(),
  is_current: z.boolean(),
  effective_from_session_key: isoDate.nullable(),
});
export const levelProgressResponseSchema = z.object({
  current_level: levelSchema,
  levels: z.array(levelProgressSchema),
  journey_completed: z.boolean(),
  /** Requirements here are provisional until the owner approves them. */
  provisional: z.literal(true),
});
export type LevelProgressResponse = z.infer<typeof levelProgressResponseSchema>;

// ---- reports (§19.5) ----
export const calendarDaySchema = z.object({
  date: isoDate,
  status: sessionStatusSchema,
  level: levelSchema.nullable(),
  has_progress: z.boolean(),
});
export const calendarResponseSchema = z.object({ days: z.array(calendarDaySchema) });
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;

export const statusCountsSchema = z.object({
  completed: z.number().int(),
  partial: z.number().int(),
  missed: z.number().int(),
  excused: z.number().int(),
  upcoming: z.number().int(),
});

export const activityStatSchema = z.object({
  id: z.string(),
  key: z.string(),
  phase: z.string(),
  sessions: z.number().int(),
  with_progress: z.number().int(),
  times_completed: z.number().int(),
  total_count: z.number().int(),
});
export const insightSchema = z.object({
  type: z.enum(["first_completion", "return_after_gap", "milestone_progress", "improvement", "stable_consistency"]),
  message: z.string(),
});

export const reportPeriodSchema = z.union([z.literal(7), z.literal(30), z.literal(90)]);
export const reportResponseSchema = z.object({
  period: reportPeriodSchema,
  from: isoDate.nullable(),
  to: isoDate.nullable(),
  status_counts: statusCountsSchema,
  /** Percent with two decimals, or null when there is no denominator ("Belum ada data"). */
  completion_rate: z.number().nullable(),
  activity_statistics: z.array(activityStatSchema),
  insight: insightSchema.nullable(),
});
export type ReportResponse = z.infer<typeof reportResponseSchema>;

export const sessionHistoryItemSchema = z.object({
  session_key: isoDate,
  status: sessionStatusSchema,
  level: levelSchema,
  required_done: z.number().int(),
  required_total: z.number().int(),
});
export const sessionHistoryResponseSchema = z.object({ sessions: z.array(sessionHistoryItemSchema) });
export type SessionHistoryResponse = z.infer<typeof sessionHistoryResponseSchema>;

export const dashboardSchema = z.object({
  /** True in mock mode. The UI must show the "DEMO DATA" badge. */
  is_demo: z.boolean(),
  level: levelSchema,
  level_progress: levelProgressResponseSchema,
  prayer_time: prayerTimeSchema,
  status_counts: statusCountsSchema,
  completion_rate: z.number().nullable(),
  calendar_days: z.array(calendarDaySchema),
  activity_statistics: z.array(activityStatSchema),
  insight: insightSchema.nullable(),
  current_session: z
    .object({
      id: z.string().nullable(),
      session_key: isoDate,
      status: sessionStatusSchema,
      state: z.enum(["scheduled", "in_progress", "completed", "partial", "missed", "excused"]),
      required_done: z.number().int(),
      required_total: z.number().int(),
    })
    .nullable(),
  setup_cards: z.array(z.object({ key: z.enum(["location", "notifications", "install_app"]), done: z.boolean() })),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

// ---- Qur'an progress (§19.6). Position only: no Qur'an text lives in this layer. ----
export const quranProgressSchema = z.object({
  surah: z.number().int().min(1).max(114),
  ayah: z.number().int().min(1).nullable(),
  updated_at: isoInstant,
});
export type QuranProgress = z.infer<typeof quranProgressSchema>;
export const quranProgressUpdateSchema = z.object({ ayah: z.number().int().min(1).nullable() });
export type QuranProgressUpdate = z.infer<typeof quranProgressUpdateSchema>;
export const quranProgressListSchema = z.object({ progress: z.array(quranProgressSchema) });

// ---- notification preferences (§19.7) ----
const clock = z.string().regex(/^\d{2}:\d{2}$/);
export const notificationPreferencesSchema = z.object({
  bedtime: z.object({ enabled: z.boolean(), target_sleep_time: clock, offset_minutes: z.number().int().min(0) }),
  tahajud: z.object({ enabled: z.boolean() }),
  fajr: z.object({ enabled: z.boolean() }),
  alkahfi: z.object({ enabled: z.boolean() }),
  achievement: z.object({ enabled: z.boolean() }),
  quiet_hours: z.object({ enabled: z.boolean(), start: clock, end: clock, allow_worship: z.boolean() }),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

// ---- auth (§19.1, §24.1) ----
export const requestOtpRequestSchema = z.object({ email: z.string().trim().min(3).max(254) });
export type RequestOtpRequest = z.infer<typeof requestOtpRequestSchema>;
/** Identical for registered and unregistered emails (anti enumeration). */
export const requestOtpResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
  resend_after_seconds: z.number().int(),
});
export type RequestOtpResponse = z.infer<typeof requestOtpResponseSchema>;

export const verifyOtpRequestSchema = z.object({
  email: z.string().trim().min(3).max(254),
  code: z.string().regex(/^\d{6}$/),
});
export type VerifyOtpRequest = z.infer<typeof verifyOtpRequestSchema>;

export const authUserSchema = z.object({ id: z.string(), email: z.string() });
export const verifyOtpResponseSchema = z.object({
  user: authUserSchema,
  device_id: z.string(),
  expires_at: isoInstant,
  access: accessSchema,
});
export type VerifyOtpResponse = z.infer<typeof verifyOtpResponseSchema>;

export const deviceSchema = z.object({
  id: z.string(),
  label: z.string(),
  last_seen_at: isoInstant,
  is_current: z.boolean(),
});
export type Device = z.infer<typeof deviceSchema>;

/**
 * 4th device (PRD §24.1): the code was right, but 3 devices are already active. No session is created.
 * `pending_token` lets the user remove one device and continue. It lasts 10 minutes and works once.
 */
export const deviceLimitResponseSchema = z.object({
  status: z.literal("device_limit"),
  max_devices: z.number().int(),
  pending_token: z.string().min(1),
  pending_expires_at: isoInstant,
  devices: z.array(deviceSchema),
});
export type DeviceLimitResponse = z.infer<typeof deviceLimitResponseSchema>;

/** POST /auth/verify-otp answer: signed in, or blocked by the device limit. */
export type VerifyOtpResult = ({ status: "ok" } & VerifyOtpResponse) | DeviceLimitResponse;

/** POST /auth/complete-pending-login */
export const completePendingLoginRequestSchema = z.object({
  pending_token: z.string().min(1),
  revoke_device_id: z.string().min(1),
});
export type CompletePendingLoginRequest = z.infer<typeof completePendingLoginRequestSchema>;

export const authSessionSchema = z.object({
  authenticated: z.boolean(),
  /** Why the user is signed out: never signed in or logged out, session ran out, or another device signed this one out. */
  reason: z.enum(["none", "expired", "revoked"]).nullable(),
  user: authUserSchema.nullable(),
  device_id: z.string().nullable(),
  expires_at: isoInstant.nullable(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

// ---- profile (§19.2) ----
export const themePrefSchema = z.enum(["system", "light", "dark", "auto-night"]);
export const profileSchema = z.object({
  user_id: z.string(),
  display_name: z.string().nullable(),
  region_id: z.string().nullable(),
  schedule_mode: z.enum(["region", "manual"]),
  timezone: z.string(),
  /** Null until onboarding completes. */
  program_start_date: isoDate.nullable(),
  onboarding_completed: z.boolean(),
  theme_pref: themePrefSchema,
  quran_font_size: z.number().int().min(24).max(44),
  dhikr_font_size: z.number().int().min(26).max(34),
});
export type Profile = z.infer<typeof profileSchema>;

export const profileUpdateSchema = z.object({ display_name: z.string().trim().max(60).nullable() });
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const preferencesUpdateSchema = z
  .object({
    theme_pref: themePrefSchema,
    quran_font_size: z.number().int().min(24).max(44),
    dhikr_font_size: z.number().int().min(26).max(34),
  })
  .partial();
export type PreferencesUpdate = z.infer<typeof preferencesUpdateSchema>;
