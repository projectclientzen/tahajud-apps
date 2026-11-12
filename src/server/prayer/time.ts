/** Offset in minutes of `timeZone` at the given UTC instant. */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60000);
}

/** Converts a local date + HH:mm in `timeZone` to an ISO UTC string. */
export function localToUtcIso(date: string, hhmm: string, timeZone: string): string {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!dm || !tm) throw new RangeError(`Invalid local date/time: ${date} ${hhmm}`);
  const naive = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  let guess = naive - offsetMinutes(naive, timeZone) * 60000;
  guess = naive - offsetMinutes(guess, timeZone) * 60000;
  return new Date(guess).toISOString();
}

/** Local calendar date (YYYY-MM-DD) of an instant in `timeZone`. */
export function localDateOf(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return parts;
}
