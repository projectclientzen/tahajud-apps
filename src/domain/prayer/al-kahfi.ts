import { PROVISIONAL_SETTINGS, type DomainSettings } from "../config/provisional";
import { addDays, localDate, parseClock, weekdayOf, zonedInstant, type LocalDate } from "../time/tz";

export interface AlKahfiWindow {
  /** Thursday Maghrib. */
  start: Date;
  /** Friday Maghrib. */
  end: Date;
  fridayDate: LocalDate;
  /** True when a Maghrib time was missing and the fallback clock time was used. */
  usedFallback: boolean;
}

export interface AlKahfiInput {
  now: Date;
  tz: string;
  /** Maghrib instant for a local date, or null when the schedule has none (manual mode). */
  maghribFor: (date: LocalDate) => Date | null;
}

/**
 * Window from Thursday after Maghrib to Friday before Maghrib, local (PRD §13.5).
 * Returns the window of the Friday that is today or next, and null on other weekdays except Thursday/Friday.
 * Manual schedules without Maghrib use the fallback time (18:00 by default).
 */
export function alKahfiWindow(
  input: AlKahfiInput,
  settings: DomainSettings = PROVISIONAL_SETTINGS,
): AlKahfiWindow | null {
  const today = localDate(input.now, input.tz);
  const dow = weekdayOf(today);
  if (dow !== 4 && dow !== 5) return null;
  const friday = dow === 5 ? today : addDays(today, 1);
  const thursday = addDays(friday, -1);
  const fb = parseClock(settings.alKahfiFallbackMaghrib);
  const fallback = (d: LocalDate) => zonedInstant(d, fb.hour, fb.minute, input.tz);
  const thu = input.maghribFor(thursday);
  const fri = input.maghribFor(friday);
  return {
    start: thu ?? fallback(thursday),
    end: fri ?? fallback(friday),
    fridayDate: friday,
    usedFallback: thu === null || fri === null,
  };
}

export const isInAlKahfiWindow = (w: AlKahfiWindow | null, now: Date): boolean =>
  !!w && now.getTime() >= w.start.getTime() && now.getTime() < w.end.getTime();
