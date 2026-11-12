import { addDaysISO } from "@/lib/dates";

/** "2026-11" for a calendar date. */
export const monthOf = (date: string): string => date.slice(0, 7);

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export const monthStart = (month: string): string => `${month}-01`;
export const monthEnd = (month: string): string => addDaysISO(monthStart(shiftMonth(month, 1)), -1);

/** Monday-first weekday index of a date, 0 to 6. */
const weekdayMon = (date: string): number => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;

/** Cells of a month grid: null pads the first week, dates fill the rest. Rows are weeks of 7. */
export function monthGrid(month: string): (string | null)[] {
  const first = monthStart(month);
  const last = monthEnd(month);
  const cells: (string | null)[] = Array.from({ length: weekdayMon(first) }, () => null);
  for (let d = first; d <= last; d = addDaysISO(d, 1)) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function formatMonth(month: string): string {
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${monthStart(month)}T12:00:00Z`),
  );
}

export const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"] as const;
