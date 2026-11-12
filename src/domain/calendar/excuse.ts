import { PROVISIONAL_SETTINGS, type DomainSettings } from "../config/provisional";
import { isWithinCorrectionWindow } from "../session/keys";
import { dateRange, diffDays, isLocalDate, type LocalDate } from "../time/tz";

export type ExcuseError = "invalid_date" | "invalid_range" | "range_too_long" | "window_closed" | "not_excused";
export type ExcuseResult = { ok: true; dates: LocalDate[] } | { ok: false; error: ExcuseError };

/** Sorted unique excused dates. No reason and no category are stored (PRD §10.6, PRIV-01). */
export function normalizeExcused(dates: Iterable<LocalDate>): LocalDate[] {
  return [...new Set(dates)].sort();
}

/**
 * Add a single date (`to` omitted) or a range of at most `excuseMaxDaysPerAction` days.
 * Returns the full updated list.
 */
export function addExcuse(
  existing: readonly LocalDate[],
  from: LocalDate,
  to: LocalDate | undefined,
  settings: DomainSettings = PROVISIONAL_SETTINGS,
): ExcuseResult {
  const end = to ?? from;
  if (!isLocalDate(from) || !isLocalDate(end)) return { ok: false, error: "invalid_date" };
  if (diffDays(from, end) < 0) return { ok: false, error: "invalid_range" };
  const days = dateRange(from, end);
  if (days.length > settings.excuseMaxDaysPerAction) return { ok: false, error: "range_too_long" };
  return { ok: true, dates: normalizeExcused([...existing, ...days]) };
}

/** Cancel one excused date. Only while that session is inside its correction window (PRD §10.6). */
export function cancelExcuse(
  existing: readonly LocalDate[],
  date: LocalDate,
  now: Date,
  tz: string,
  settings: DomainSettings = PROVISIONAL_SETTINGS,
): ExcuseResult {
  if (!existing.includes(date)) return { ok: false, error: "not_excused" };
  if (!isWithinCorrectionWindow(date, now, tz, settings)) return { ok: false, error: "window_closed" };
  return { ok: true, dates: existing.filter((d) => d !== date) };
}
