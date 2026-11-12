const LOCALE = "id-ID";

const TZ_LABEL: Record<string, string> = {
  "Asia/Jakarta": "WIB",
  "Asia/Makassar": "WITA",
  "Asia/Jayapura": "WIT",
};

export const tzLabel = (tz: string) => TZ_LABEL[tz] ?? tz;

/** "04.30" in the given IANA zone. */
export function formatClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(
    new Date(iso),
  );
}

/** Date-only strings (YYYY-MM-DD) are calendar dates, so format them in UTC to avoid day shifts. */
function fromDate(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

export function formatDateLong(date: string): string {
  return new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    fromDate(date),
  );
}

export function formatDateShort(date: string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone: "UTC" }).format(fromDate(date));
}

export const dayOfMonth = (date: string) => Number(date.slice(8, 10));

/** Never negative: a Subuh that already passed reads as "0 menit". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} menit`;
  return m === 0 ? `${h} jam` : `${h} jam ${m} menit`;
}

/** Percent with up to two decimals, or a friendly empty label when there is no denominator. */
export function formatRate(rate: number | null): string {
  return rate === null ? "Belum ada data" : `${rate.toLocaleString(LOCALE, { maximumFractionDigits: 2 })}%`;
}
