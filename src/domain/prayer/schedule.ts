import { localDate, type LocalDate } from "../time/tz";

export type ScheduleSource = "provider" | "cached" | "manual";

/** One day of prayer times (PRD §14.3, §19.3). Instants are ISO strings. */
export interface PrayerSchedule {
  regionId: string | null;
  localDate: LocalDate;
  timezone: string;
  fajrAt: string;
  maghribAt: string | null;
  source: ScheduleSource;
  fetchedAt: string | null;
  validUntil: string | null;
}

export const SCHEDULE_LABEL: Record<ScheduleSource, string> = {
  provider: "Jadwal terkini",
  cached: "Jadwal tersimpan",
  manual: "Diatur manual",
};

export type ScheduleChoice =
  { ok: true; schedule: PrayerSchedule; label: string } | { ok: false; reason: "unavailable" };

export interface ChooseInput {
  mode: "region" | "manual";
  /** Fresh answer from the provider for `date`, if the call succeeded. */
  provider?: PrayerSchedule | null;
  /** Last cached schedule for the region. */
  cached?: PrayerSchedule | null;
  manual?: PrayerSchedule | null;
  date: LocalDate;
  now: Date;
}

/** Cached data is usable only for its own date and before `validUntil`. */
export function isCacheUsable(s: PrayerSchedule | null | undefined, date: LocalDate, now: Date): s is PrayerSchedule {
  if (!s || s.localDate !== date) return false;
  return s.validUntil === null || now.getTime() <= Date.parse(s.validUntil);
}

/**
 * Pick the schedule to show (PRD §14.5). Manual mode uses the manual schedule. Otherwise provider,
 * then valid cache labelled "Jadwal tersimpan". A date with no data is never shown as verified.
 */
export function chooseSchedule(input: ChooseInput): ScheduleChoice {
  const { mode, provider, cached, manual, date, now } = input;
  if (mode === "manual") {
    if (manual && manual.localDate === date) {
      const schedule = { ...manual, source: "manual" as const };
      return { ok: true, schedule, label: SCHEDULE_LABEL.manual };
    }
    return { ok: false, reason: "unavailable" };
  }
  if (provider && provider.localDate === date) {
    const schedule = { ...provider, source: "provider" as const };
    return { ok: true, schedule, label: SCHEDULE_LABEL.provider };
  }
  if (isCacheUsable(cached, date, now)) {
    const schedule = { ...cached, source: "cached" as const };
    return { ok: true, schedule, label: SCHEDULE_LABEL.cached };
  }
  return { ok: false, reason: "unavailable" };
}

/** Build a manual schedule from "HH:MM" entries the user typed (PRD §14.5). */
export function manualSchedule(args: {
  date: LocalDate;
  timezone: string;
  fajrAt: Date;
  maghribAt?: Date | null;
  now: Date;
}): PrayerSchedule {
  return {
    regionId: null,
    localDate: args.date,
    timezone: args.timezone,
    fajrAt: args.fajrAt.toISOString(),
    maghribAt: args.maghribAt ? args.maghribAt.toISOString() : null,
    source: "manual",
    fetchedAt: args.now.toISOString(),
    validUntil: null,
  };
}

/** Local date of the Fajr instant in the schedule's zone. Sanity check for stale data. */
export const scheduleFajrDate = (s: PrayerSchedule): LocalDate => localDate(new Date(s.fajrAt), s.timezone);
