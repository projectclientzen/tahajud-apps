import { PROVISIONAL_SETTINGS, type DomainSettings } from "../config/provisional";
import { addDays, localDate, zonedInstant, type LocalDate } from "../time/tz";

const HOUR_MS = 3_600_000;

/** Cutoff instant for session `date`: cutoff time on the Fajr date in the session timezone (PRD §11.1). */
export function cutoffInstant(date: LocalDate, tz: string, settings: DomainSettings = PROVISIONAL_SETTINGS): Date {
  return zonedInstant(date, settings.cutoff.hour, settings.cutoff.minute, tz);
}

/**
 * Session key = Fajr local date. Before today's cutoff the active session is today's;
 * after it, tomorrow's (PRD §11.1, SESSION-03). `now` must be server time.
 */
export function activeSessionKey(now: Date, tz: string, settings: DomainSettings = PROVISIONAL_SETTINGS): LocalDate {
  const today = localDate(now, tz);
  return now.getTime() < cutoffInstant(today, tz, settings).getTime() ? today : addDays(today, 1);
}

/** Last moment a session can still be corrected: cutoff + correction window (PRD §11.2). */
export function correctionDeadline(
  sessionKey: LocalDate,
  tz: string,
  settings: DomainSettings = PROVISIONAL_SETTINGS,
): Date {
  return new Date(cutoffInstant(sessionKey, tz, settings).getTime() + settings.correctionWindowHours * HOUR_MS);
}

export function isWithinCorrectionWindow(
  sessionKey: LocalDate,
  now: Date,
  tz: string,
  settings: DomainSettings = PROVISIONAL_SETTINGS,
): boolean {
  return now.getTime() <= correctionDeadline(sessionKey, tz, settings).getTime();
}

/** True once cutoff has passed, so the session no longer counts as upcoming. */
export function isSessionClosed(
  sessionKey: LocalDate,
  now: Date,
  tz: string,
  settings: DomainSettings = PROVISIONAL_SETTINGS,
): boolean {
  return now.getTime() >= cutoffInstant(sessionKey, tz, settings).getTime();
}
