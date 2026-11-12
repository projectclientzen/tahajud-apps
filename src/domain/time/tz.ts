/**
 * Timezone helpers on top of Intl. Indonesia has no DST, but manual schedules
 * can use any IANA zone, so nothing here assumes a fixed offset.
 * Dates are "YYYY-MM-DD" strings. Instants are `Date`.
 */
export type LocalDate = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsOf(instant: Date, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of fmt(tz).formatToParts(instant)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 0,
    day: out.day ?? 0,
    hour: out.hour ?? 0,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

export function isLocalDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function assertLocalDate(value: string): void {
  if (!isLocalDate(value)) throw new RangeError(`Invalid local date: ${value}`);
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

/** Calendar date of `instant` in `tz`. */
export function localDate(instant: Date, tz: string): LocalDate {
  const p = partsOf(instant, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Local wall-clock minutes since midnight of `instant` in `tz`. */
export function localMinutes(instant: Date, tz: string): number {
  const p = partsOf(instant, tz);
  return p.hour * 60 + p.minute;
}

export function addDays(date: LocalDate, n: number): LocalDate {
  assertLocalDate(date);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from `a` to `b` (b - a). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  assertLocalDate(a);
  assertLocalDate(b);
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** 0 = Sunday ... 6 = Saturday, for the calendar date itself (zone independent). */
export function weekdayOf(date: LocalDate): number {
  assertLocalDate(date);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Inclusive list of dates from `from` to `to`. Empty if `to < from`. */
export function dateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const n = diffDays(from, to);
  const out: LocalDate[] = [];
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

/** Parse "HH:MM". */
export function parseClock(hhmm: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  const hour = m ? Number(m[1]) : NaN;
  const minute = m ? Number(m[2]) : NaN;
  if (!m || hour > 23 || minute > 59) throw new RangeError(`Invalid clock time: ${hhmm}`);
  return { hour, minute };
}

/** Instant at which the wall clock in `tz` reads `date` `hour:minute`. */
export function zonedInstant(date: LocalDate, hour: number, minute: number, tz: string): Date {
  assertLocalDate(date);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, hour, minute, 0);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = partsOf(new Date(guess), tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const delta = wall - shown;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Indonesian regional zones (PRD §11.1). */
export const ID_TIMEZONES = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"] as const;
