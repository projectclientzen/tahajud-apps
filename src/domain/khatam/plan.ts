/**
 * Khatam plan (CHANGE-2026-11-13 M2). Pure rules, no clock, no I/O.
 *
 * Owner table: the user picks N = 1..5 khatam for a 30 day period. Per prayer time (Subuh, Dzuhur, Ashar, Maghrib,
 * Isya) the user reads 4N pages. 30 days x 5 prayers x 4N = 600N pages, the Madinah mushaf has 604N, so 4N pages
 * are left over.
 *
 * PROVISIONAL (orchestrator default, owner has not decided): the 4N leftover pages go to the LAST day, spread over its
 * five prayer times as evenly as whole pages allow, the earlier prayers taking the remainder. Day 30 therefore asks
 * for 24N pages instead of 20N, and no single prayer time carries the whole difference.
 */
export const KHATAM_DAYS = 30;
export const MUSHAF_PAGES = 604;
export const MIN_KHATAM = 1;
export const MAX_KHATAM = 5;

export const PRAYERS = ["subuh", "dzuhur", "ashar", "maghrib", "isya"] as const;
export type Prayer = (typeof PRAYERS)[number];

export const PRAYER_LABEL: Readonly<Record<Prayer, string>> = {
  subuh: "Subuh",
  dzuhur: "Dzuhur",
  ashar: "Ashar",
  maghrib: "Maghrib",
  isya: "Isya",
};

/** Marks the leftover rule as awaiting the owner. */
export const KHATAM_PROVISIONAL = { provisional: true, rule: "leftover_4N_on_last_day" } as const;

export const isValidKhatamCount = (n: number): boolean => Number.isInteger(n) && n >= MIN_KHATAM && n <= MAX_KHATAM;
export const isValidDay = (day: number): boolean => Number.isInteger(day) && day >= 1 && day <= KHATAM_DAYS;

export function totalPages(n: number): number {
  assertCount(n);
  return MUSHAF_PAGES * n;
}

/** Pages asked for one prayer time on one day (day is 1..30). */
export function slotPages(n: number, day: number, prayer: Prayer): number {
  assertCount(n);
  if (!isValidDay(day)) throw new RangeError(`day must be 1..${KHATAM_DAYS}`);
  const base = 4 * n;
  if (day < KHATAM_DAYS) return base;
  const lastDay = 5 * base + 4 * n; // 24N
  const each = Math.floor(lastDay / PRAYERS.length);
  const extra = lastDay % PRAYERS.length;
  return each + (PRAYERS.indexOf(prayer) < extra ? 1 : 0);
}

export function dayPages(n: number, day: number): number {
  return PRAYERS.reduce((sum, p) => sum + slotPages(n, day, p), 0);
}

/** Pages asked from day 1 through the end of `day` (0 gives 0, 30 gives 604N). */
export function pagesDueThrough(n: number, day: number): number {
  assertCount(n);
  if (!Number.isInteger(day) || day < 0) throw new RangeError("day must be a whole number >= 0");
  let sum = 0;
  for (let d = 1; d <= Math.min(day, KHATAM_DAYS); d++) sum += dayPages(n, d);
  return sum;
}

function assertCount(n: number): void {
  if (!isValidKhatamCount(n)) throw new RangeError(`khatam count must be ${MIN_KHATAM}..${MAX_KHATAM}`);
}
