/**
 * Provisional settings (PRD v1.2 §30.2, AGENT_BRIEF §5).
 * Every value here is waiting for owner or mentor approval. Do not treat as final.
 * Pure data: no clock reads, no env reads. Callers pass `settings` into domain functions.
 */
export type LevelNumber = 1 | 2 | 3;
export const LEVELS: readonly LevelNumber[] = [1, 2, 3];

export type NotificationType = "bedtime" | "tahajud" | "fajr" | "alkahfi" | "achievement";

export interface LevelSettings {
  /** Completed sessions needed to unlock the next level (PRD §10.1). */
  requiredSuccessfulNights: number;
  suggestedPeriodNights: number;
  estimatedDurationMinutes: number;
}

export interface DomainSettings {
  /** Marks every value below as not yet approved. */
  readonly provisional: true;
  /** Local time of the daily session cutoff (PRD §11.1). */
  cutoff: { hour: number; minute: number };
  /** Correction window after cutoff, in hours (PRD §11.2). */
  correctionWindowHours: number;
  levels: Record<LevelNumber, LevelSettings>;
  /** Preparation buffer between wake-up and the worship start, minutes (PRD §14.6). */
  wakeBufferMinutes: number;
  /** Warn when planned sleep is shorter than this many hours (PRD §14.6). */
  minSleepHours: number;
  /** Max days per excuse action (PRD §10.6). */
  excuseMaxDaysPerAction: number;
  /** Notification expiry in minutes after scheduled time (PRD §15.1). */
  notificationExpiryMinutes: Record<NotificationType, number>;
  /** Bedtime rotation: avoid the last N sent messages (PRD §15.2). */
  bedtimeAvoidLast: number;
  /** Minimum approved bedtime messages before launch (PRD §15.2). */
  bedtimeBankMinimum: number;
  /** Al-Kahfi window end fallback for manual schedules, local "HH:MM" (brief S2). */
  alKahfiFallbackMaghrib: string;
}

export const PROVISIONAL_SETTINGS: DomainSettings = {
  provisional: true,
  cutoff: { hour: 12, minute: 0 },
  correctionWindowHours: 48,
  levels: {
    1: { requiredSuccessfulNights: 7, suggestedPeriodNights: 14, estimatedDurationMinutes: 60 },
    2: { requiredSuccessfulNights: 12, suggestedPeriodNights: 21, estimatedDurationMinutes: 120 },
    3: { requiredSuccessfulNights: 20, suggestedPeriodNights: 30, estimatedDurationMinutes: 150 },
  },
  wakeBufferMinutes: 10,
  minSleepHours: 5,
  excuseMaxDaysPerAction: 15,
  notificationExpiryMinutes: {
    bedtime: 30,
    tahajud: 15,
    fajr: 20,
    alkahfi: 360,
    achievement: 1440,
  },
  bedtimeAvoidLast: 14,
  bedtimeBankMinimum: 30,
  alKahfiFallbackMaghrib: "18:00",
};

/** Settings key paths that are provisional, for the admin "Menunggu persetujuan" list (S8). */
export const PROVISIONAL_ITEMS = [
  "cutoff",
  "correctionWindowHours",
  "levels.*.requiredSuccessfulNights",
  "levels.*.suggestedPeriodNights",
  "levels.*.estimatedDurationMinutes",
  "wakeBufferMinutes",
  "minSleepHours",
  "excuseMaxDaysPerAction",
  "notificationExpiryMinutes",
  "bedtimeAvoidLast",
  "bedtimeBankMinimum",
  "alKahfiFallbackMaghrib",
] as const;

/**
 * Auth settings still waiting for approval (CLAUDE.md auth rules, SCALEV-AUTH-PLAN §3.7, §3.8, §8.9).
 * Defaults chosen by the planning session until the owner changes them. Every number here is PROVISIONAL.
 */
export const PROVISIONAL_AUTH = {
  provisional: true,
  /** User session lifetime with refresh, days. */
  sessionDays: 30,
  /** Active devices per user. */
  maxActiveDevices: 3,
  passwordMinLength: 10,
  passwordMaxLength: 128,
  /** Admin reset link lifetime, minutes. Also seeded as app_settings.reset_token_minutes. */
  adminResetTokenMinutes: 60,
  /** Windows are fixed windows in seconds. `fails` counts failures only, `hits` counts every attempt. */
  limits: {
    /** Failed logins per IP per 10 minutes (successful ones do not count, so many buyers behind one operator IP are safe). */
    loginIpPer10Min: 30,
    loginFailsPerEmail: 10,
    loginFailWindowSeconds: 900,
    activateFailsPerEmail: 5,
    activateFailsPerPhone: 5,
    activateFailWindowSeconds: 900,
    /** Failed activations or resets per IP per hour (failures only). */
    activateIpPerHour: 20,
    activatePairPerHour: 3,
    tokenIpPer10Min: 30,
    tokenPerHour: 10,
    changePasswordFailsPer15Min: 5,
  },
  /**
   * Stepped delay per email (and per phone for activation), replacing a hard 15 minute lock (T9 F2).
   * The first `freeAttempts` per key are free. After that each attempt sets the next wait from `delaySeconds`
   * (1, 2, 5, 15 minutes; the last value repeats). A key left quiet for `idleResetSeconds` starts again from zero.
   * A correct login, or an activation whose email and phone match one order, gives its slot back.
   */
  gate: {
    freeAttempts: 5,
    delaySeconds: [60, 120, 300, 900],
    idleResetSeconds: 3600,
  },
} as const;
