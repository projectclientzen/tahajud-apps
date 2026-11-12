export type ScheduleSource = "provider" | "cached" | "manual";

/** One local day. Times are ISO 8601 UTC strings. */
export interface PrayerDay {
  regionId: string;
  /** Local date in the region timezone, YYYY-MM-DD. */
  date: string;
  fajrAt: string;
  maghribAt: string | null;
  timezone: string;
  provider: string;
  methodVersion?: string;
  fetchedAt: string;
  validUntil: string;
}

export interface PrayerTimeProvider {
  readonly name: string;
  /** month is 1-12. Returns every day of that month. */
  fetchMonth(regionId: string, year: number, month: number): Promise<PrayerDay[]>;
}

export type PrayerErrorCode =
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_NOT_IMPLEMENTED"
  | "PROVIDER_FAILED"
  | "SCHEDULE_UNAVAILABLE";

export class PrayerError extends Error {
  readonly code: PrayerErrorCode;
  constructor(code: PrayerErrorCode, message: string) {
    super(message);
    this.name = "PrayerError";
    this.code = code;
  }
}

export interface PrayerCache {
  get(key: string): PrayerDay[] | undefined;
  set(key: string, days: PrayerDay[]): void;
}

export interface ResolvedPrayerDay {
  day: PrayerDay;
  source: ScheduleSource;
}

export interface ManualSchedule {
  /** HH:mm local time. */
  fajr: string;
  maghrib?: string;
  timezone: string;
}
