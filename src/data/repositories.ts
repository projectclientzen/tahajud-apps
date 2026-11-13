import type {
  Access,
  AuthSession,
  Device,
  PreferencesUpdate,
  Profile,
  ProfileUpdate,
  SignInResponse,
  SignInResult,
  CalendarResponse,
  ChecklistUpdateRequest,
  CounterOperationsRequest,
  CounterOperationsResponse,
  Dashboard,
  DataExport,
  DeleteAccountResponse,
  NotificationList,
  PrayerTimesQuery,
  PrayerTimesResponse,
  PushSubscriptionInfo,
  PushSubscriptionRequest,
  QuranSurahDetail,
  QuranSurahList,
  ExcuseRequest,
  ExcuseResponse,
  KhatamCreateRequest,
  KhatamMarkRequest,
  KhatamResponse,
  KhatamSlotRequest,
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

export interface KhatamRepository {
  /** GET /khatam. The current target, ticked slots and the server clock. */
  getKhatam(): Promise<KhatamResponse>;
  /** POST /khatam. Starts a 30 day target. Refused while a running target is not finished or past its 30 days. */
  createTarget(req: KhatamCreateRequest): Promise<KhatamResponse>;
  /** PUT /khatam/target. Changes N for the running target. Pages already read stay. */
  changeTarget(req: KhatamCreateRequest): Promise<KhatamResponse>;
  /** PUT /khatam/slots. Tick or untick a prayer slot of day 1 up to today. A set, so safe to replay. */
  setSlot(req: KhatamSlotRequest): Promise<KhatamResponse>;
  /** PUT /khatam/position. "Read up to page X". Safe to replay. */
  markPosition(req: KhatamMarkRequest): Promise<KhatamResponse>;
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
  /** POST /auth/login. With 3 active devices the answer is `device_limit` and no session is created. */
  login(email: string, password: string, deviceLabel?: string): Promise<SignInResult>;
  /**
   * POST /auth/activate. One step: email + phone of the paid order + a new password. Every failure is one
   * `ACTIVATION_FAILED` answer that does not say why.
   */
  activate(input: { email: string; phone: string; password: string; deviceLabel?: string }): Promise<SignInResult>;
  /** POST /auth/reset-password. Same proof as activation. Signs every device out and opens no session. */
  resetPassword(input: { email: string; phone: string; newPassword: string }): Promise<void>;
  /** POST /auth/set-password. A reset link made by an admin. Signs in on success. */
  setPasswordWithToken(token: string, password: string, deviceLabel?: string): Promise<SignInResult>;
  /** POST /me/password. Other devices are signed out. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** POST /auth/complete-pending-login. Removes one device, then signs in. The token works once. */
  completePendingLogin(pendingToken: string, revokeDeviceId: string, deviceLabel?: string): Promise<SignInResponse>;
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
  khatam: KhatamRepository;
  notifications: NotificationRepository;
  profile: ProfileRepository;
}

// ---- T3c: endpoints that only the live (HTTP) layer has so far. The mock layer gets them when a screen needs them. ----

export interface PrayerTimesRepository {
  /** GET /prayer-times. Stored days of a region (the user's own by default). */
  getPrayerTimes(query?: PrayerTimesQuery): Promise<PrayerTimesResponse>;
}

export interface QuranCatalogRepository {
  /** GET /quran/surahs. The surahs the dataset has, with source and licence. */
  listSurahs(): Promise<QuranSurahList>;
  /** GET /quran/surahs/:id. Text verbatim from the dataset. Unknown surah is NOT_FOUND, never invented text. */
  getSurah(surah: number): Promise<QuranSurahDetail>;
}

export interface PushRepository {
  /** POST /me/push-subscriptions. Same browser subscribing again replaces the old row. */
  addSubscription(req: PushSubscriptionRequest): Promise<PushSubscriptionInfo>;
  /** DELETE /me/push-subscriptions/:id. Own subscriptions only: someone else's id is NOT_FOUND. */
  removeSubscription(id: string): Promise<void>;
  /** GET /me/notifications */
  listNotifications(limit?: number): Promise<NotificationList>;
}

export interface AccountRepository {
  /** POST /me/data-export. Works without active access. */
  exportData(): Promise<DataExport>;
  /** POST /me/delete-account. Deletes the account at once. The browser must clear its local data afterwards. */
  deleteAccount(): Promise<DeleteAccountResponse>;
}

export interface LiveExtras {
  prayerTimes: PrayerTimesRepository;
  quranCatalog: QuranCatalogRepository;
  push: PushRepository;
  account: AccountRepository;
}
