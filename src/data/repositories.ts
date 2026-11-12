import type {
  Access,
  AuthSession,
  Device,
  PreferencesUpdate,
  Profile,
  ProfileUpdate,
  RequestOtpResponse,
  VerifyOtpResponse,
  CalendarResponse,
  ChecklistUpdateRequest,
  CounterOperationsRequest,
  CounterOperationsResponse,
  Dashboard,
  ExcuseRequest,
  ExcuseResponse,
  LevelProgressResponse,
  LocationUpdate,
  NightSession,
  NotificationPreferences,
  PrayerTime,
  QuranProgress,
  QuranProgressUpdate,
  Region,
  ReportResponse,
  SessionHistoryResponse,
  SessionSummary,
  WakePlan,
} from "./contracts";
import type { LevelNumber } from "@/domain/config/provisional";

/** One interface per API area. UI code depends on these, never on mock data. Each method maps to a §19 endpoint. */

export interface AccessRepository {
  /** GET /me/access */
  getAccess(): Promise<Access>;
}

export interface SessionRepository {
  /** GET /me/night-session. Null until the first interaction creates the row. */
  getActiveSession(): Promise<NightSession | null>;
  /** POST /me/night-sessions. Idempotent: returns the existing row for the active key. */
  ensureActiveSession(): Promise<NightSession>;
  /** GET /night-sessions/:id */
  getSession(id: string): Promise<NightSession>;
  /** PUT /session-activities/:id/status. Needs the current `version`. */
  setChecklist(activityId: string, req: ChecklistUpdateRequest): Promise<NightSession>;
  /** POST /session-activities/:id/counter-operations. At most 50 operations. */
  applyCounterOperations(activityId: string, req: CounterOperationsRequest): Promise<CounterOperationsResponse>;
  /** GET /night-sessions/:id/summary. Opening it never changes status. */
  getSummary(sessionId: string): Promise<SessionSummary>;
}

export interface ProgressRepository {
  /** GET /me/current-level */
  getCurrentLevel(): Promise<{ level: LevelNumber; effective_from_session_key: string | null }>;
  /** GET /me/level-progress */
  getLevelProgress(): Promise<LevelProgressResponse>;
}

export interface ExcuseRepository {
  /** POST /me/excuse. One date or a range of at most 15 days. */
  addExcuse(req: ExcuseRequest): Promise<ExcuseResponse>;
  /** DELETE /me/excuse/:date. Only inside the correction window. */
  cancelExcuse(date: string): Promise<ExcuseResponse>;
}

export interface ReportRepository {
  /** GET /me/dashboard */
  getDashboard(): Promise<Dashboard>;
  /** GET /me/reports?period= */
  getReport(period: 7 | 30 | 90): Promise<ReportResponse>;
  /** GET /me/calendar?from&to */
  getCalendar(from?: string, to?: string): Promise<CalendarResponse>;
  /** GET /me/session-history */
  getSessionHistory(): Promise<SessionHistoryResponse>;
}

export interface PrayerRepository {
  /** GET /regions */
  listRegions(): Promise<Region[]>;
  /** GET /me/next-fajr */
  getNextFajr(): Promise<PrayerTime>;
  /** GET /me/wake-plan */
  getWakePlan(): Promise<WakePlan>;
  /** PUT /me/location. Takes effect from the next session. */
  setLocation(req: LocationUpdate): Promise<PrayerTime>;
}

export interface QuranProgressRepository {
  /** GET /me/quran-progress. Reading position only, no text. */
  getProgress(): Promise<QuranProgress[]>;
  /** PUT /me/quran-progress/:surah */
  putProgress(surah: number, req: QuranProgressUpdate): Promise<QuranProgress>;
}

export interface NotificationRepository {
  /** GET /me/notification-preferences */
  getPreferences(): Promise<NotificationPreferences>;
  /** PUT /me/notification-preferences */
  putPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences>;
}

export interface ProfileRepository {
  /** GET /me/profile */
  getProfile(): Promise<Profile>;
  /** PATCH /me/profile */
  updateProfile(patch: ProfileUpdate): Promise<Profile>;
  /** PUT /me/location. Region or manual schedule. Same rules as PrayerRepository.setLocation. */
  setLocation(req: LocationUpdate): Promise<PrayerTime>;
  /** POST /me/onboarding/complete. Sets program_start_date once (S2-3). Calling again changes nothing. */
  completeOnboarding(): Promise<Profile>;
  /** PUT /me/preferences. Display preferences only. */
  updatePreferences(patch: PreferencesUpdate): Promise<Profile>;
}

/** Sign-in side. Lives outside DataLayer because it exists before a user id does. */
export interface AuthRepository {
  /** POST /auth/request-otp. The answer never depends on whether the email has access. */
  requestOtp(email: string): Promise<RequestOtpResponse>;
  /** POST /auth/verify-otp */
  verifyOtp(email: string, code: string, deviceLabel?: string): Promise<VerifyOtpResponse>;
  /** GET /me, auth part */
  getSession(): Promise<AuthSession>;
  /** POST /auth/logout. This device only. */
  logout(): Promise<void>;
  /** GET /me/devices */
  listDevices(): Promise<Device[]>;
  /** DELETE /me/devices/:id. Another device only. */
  revokeDevice(id: string): Promise<void>;
}

export interface DataLayer {
  mode: "mock" | "live";
  access: AccessRepository;
  session: SessionRepository;
  progress: ProgressRepository;
  excuse: ExcuseRepository;
  report: ReportRepository;
  prayer: PrayerRepository;
  quran: QuranProgressRepository;
  notifications: NotificationRepository;
  profile: ProfileRepository;
}
