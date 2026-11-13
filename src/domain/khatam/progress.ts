import { addDays, diffDays, localDate, type LocalDate } from "../time/tz";
import {
  KHATAM_DAYS,
  MUSHAF_PAGES,
  PRAYERS,
  pagesDueThrough,
  slotPages,
  totalPages,
  type Prayer,
} from "./plan";

/** One ticked prayer slot. `pages` is what the slot was worth when it was ticked, so changing N later rewrites nothing. */
export interface SlotRead {
  /** 1..30 */
  day: number;
  prayer: Prayer;
  pages: number;
}

export interface KhatamState {
  khatamCount: number;
  /** Local date (user timezone) the target was created. Day 1. */
  startDate: LocalDate;
  /** User timezone at creation. Day boundaries use this, never the server or browser zone. */
  timezone: string;
  /** Pages added or removed by "read up to page X" marks, on top of the ticked slots. */
  adjustment: number;
  reads: readonly SlotRead[];
}

export const endDateOf = (startDate: LocalDate): LocalDate => addDays(startDate, KHATAM_DAYS - 1);

/** Day number in the 30 day period for an instant: 1..30 inside, <1 before the start, >30 after the end. */
export function dayNumber(startDate: LocalDate, now: Date, tz: string): number {
  return diffDays(startDate, localDate(now, tz)) + 1;
}

/** Pages read, clamped to 0..total. Ticked slots plus adjustment. */
export function pagesRead(s: Pick<KhatamState, "khatamCount" | "adjustment" | "reads">): number {
  const raw = s.reads.reduce((n, r) => n + r.pages, 0) + s.adjustment;
  return Math.min(Math.max(raw, 0), totalPages(s.khatamCount));
}

/**
 * "Read up to page X" from the reader. X is a page of the mushaf (1..604). The new position is the value
 * k*604 + X (k = a khatam number) closest to where the user is now, so tapping a page in the khatam being read moves
 * within it, finishing page 604 and reading on into page 3 of the next khatam moves forward, and tapping the same
 * page twice changes nothing. A tie goes forward. Result stays in 0..total.
 */
export function positionAfterMark(current: number, page: number, khatamCount: number): number {
  if (!Number.isInteger(page) || page < 1 || page > MUSHAF_PAGES) throw new RangeError("page must be 1..604");
  const total = totalPages(khatamCount);
  const k = Math.floor(current / MUSHAF_PAGES);
  let best = -1;
  let bestDist = Infinity;
  for (const cand of [(k - 1) * MUSHAF_PAGES + page, k * MUSHAF_PAGES + page, (k + 1) * MUSHAF_PAGES + page]) {
    // k >= 0: "page X of khatam k+1". Without this, page 604 with k = -1 would give position 0 (nothing read).
    if (cand < page || cand > total) continue;
    const dist = Math.abs(cand - current);
    if (dist < bestDist || (dist === bestDist && cand > best)) {
      best = cand;
      bestDist = dist;
    }
  }
  return best;
}

/** Adjustment that makes `pagesRead` equal `target` given the ticked slots. */
export function adjustmentFor(target: number, reads: readonly SlotRead[]): number {
  return target - reads.reduce((n, r) => n + r.pages, 0);
}

export type KhatamStatus = "active" | "completed" | "ended";

export interface SlotView {
  prayer: Prayer;
  pages: number;
  done: boolean;
  /** Where this slot starts and ends in the mushaf (1..604), counting from the reading position. Null when done. */
  fromPage: number | null;
  toPage: number | null;
}

export interface KhatamView {
  khatamCount: number;
  status: KhatamStatus;
  startDate: LocalDate;
  endDate: LocalDate;
  /** Today's day number clamped to 1..30. */
  day: number;
  daysLeft: number;
  totalPages: number;
  pagesRead: number;
  pagesLeft: number;
  /** 0..100, one decimal at most. */
  percent: number;
  /** Which khatam the user is reading (1..N), N once everything is read. */
  khatamNumber: number;
  completedKhatam: number;
  /** Next page to read (1..604), null when all done. */
  currentPage: number | null;
  /** Today's five slots. Empty once the period is over. */
  today: SlotView[];
  /** Pages the plan asked for through today's end. */
  dueToday: number;
  /** Pages still open from days before today (never negative). Shown as "sisa", not as a failure. */
  carriedOver: number;
}

/** Page after `read` pages, wrapped into 1..604. */
export const pageAfter = (read: number): number => (read % MUSHAF_PAGES) + 1;

export function computeKhatam(state: KhatamState, now: Date): KhatamView {
  const n = state.khatamCount;
  const total = totalPages(n);
  const read = pagesRead(state);
  const rawDay = dayNumber(state.startDate, now, state.timezone);
  const day = Math.min(Math.max(rawDay, 1), KHATAM_DAYS);
  const over = rawDay > KHATAM_DAYS;
  const complete = read >= total;
  const status: KhatamStatus = complete ? "completed" : over ? "ended" : "active";

  const today: SlotView[] = [];
  if (status === "active") {
    let cursor = read;
    for (const prayer of PRAYERS) {
      const done = state.reads.some((r) => r.day === day && r.prayer === prayer);
      const pages = slotPages(n, day, prayer);
      if (done) {
        today.push({ prayer, pages, done, fromPage: null, toPage: null });
      } else {
        const remaining = Math.max(Math.min(pages, total - cursor), 0);
        today.push({
          prayer,
          pages,
          done,
          fromPage: remaining > 0 ? pageAfter(cursor) : null,
          toPage: remaining > 0 ? pageAfter(cursor + remaining - 1) : null,
        });
        cursor += remaining;
      }
    }
  }

  const dueToday = pagesDueThrough(n, day);
  const dueBeforeToday = pagesDueThrough(n, day - 1);
  return {
    khatamCount: n,
    status,
    startDate: state.startDate,
    endDate: endDateOf(state.startDate),
    day,
    daysLeft: over || complete ? 0 : KHATAM_DAYS - day + 1,
    totalPages: total,
    pagesRead: read,
    pagesLeft: total - read,
    percent: Math.round((read / total) * 1000) / 10,
    khatamNumber: complete ? n : Math.floor(read / MUSHAF_PAGES) + 1,
    completedKhatam: Math.floor(read / MUSHAF_PAGES),
    currentPage: complete ? null : pageAfter(read),
    today,
    dueToday,
    carriedOver: status === "active" ? Math.max(dueBeforeToday - read, 0) : 0,
  };
}

