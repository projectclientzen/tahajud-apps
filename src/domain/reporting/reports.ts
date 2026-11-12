import type { CalendarDay, SessionRecord } from "../calendar/calendar";
import type { SessionStatus } from "../content/session-status";
import { isActivityDone, hasProgress } from "../session/status";
import { addDays, diffDays, type LocalDate } from "../time/tz";

export type StatusCounts = Record<SessionStatus, number>;
export type ReportPeriod = 7 | 30 | 90;

export function statusCounts(days: readonly CalendarDay[]): StatusCounts {
  const counts: StatusCounts = { completed: 0, partial: 0, missed: 0, excused: 0, upcoming: 0 };
  for (const d of days) counts[d.status] += 1;
  return counts;
}

/**
 * completed / (completed + partial + missed) x 100, two decimals (PRD §22.2).
 * Excused and upcoming are not counted. Denominator 0 gives null ("Belum ada data"), never 0%.
 */
export function completionRate(days: readonly CalendarDay[]): number | null {
  const c = statusCounts(days);
  const denominator = c.completed + c.partial + c.missed;
  if (denominator === 0) return null;
  return Math.round((c.completed / denominator) * 10_000) / 100;
}

/**
 * Days for a 7/30/90 filter: the last N closed sessions, never earlier than `programStartDate`
 * (PRD §22.2, BUG-13). The active (upcoming) session is excluded.
 */
export function selectPeriod(
  days: readonly CalendarDay[],
  period: ReportPeriod,
  programStartDate: LocalDate,
  activeKey: LocalDate,
): CalendarDay[] {
  const lastClosed = addDays(activeKey, -1);
  const naive = addDays(lastClosed, -(period - 1));
  const from = diffDays(programStartDate, naive) > 0 ? naive : programStartDate;
  return days.filter((d) => d.date >= from && d.date <= lastClosed);
}

export interface ActivityStat {
  id: string;
  key: string;
  phase: string;
  /** Sessions whose snapshot included this activity. */
  sessions: number;
  /** Sessions with any progress on it. */
  withProgress: number;
  /** Sessions where it reached its own target or was ticked. */
  timesCompleted: number;
  /** Sum of counter counts. Includes excused sessions (PRD §10.6). */
  totalCount: number;
}

/** Per-activity frequency over the given sessions, from each session's own snapshot (PRD §22.3). */
export function activityStats(records: readonly SessionRecord[]): ActivityStat[] {
  const map = new Map<string, ActivityStat>();
  for (const r of records) {
    for (const a of r.activities) {
      let s = map.get(a.id);
      if (!s) {
        const idx = a.id.indexOf(":");
        s = {
          id: a.id,
          key: a.id.slice(idx + 1),
          phase: a.id.slice(0, idx),
          sessions: 0,
          withProgress: 0,
          timesCompleted: 0,
          totalCount: 0,
        };
        map.set(a.id, s);
      }
      s.sessions += 1;
      if (hasProgress(a)) s.withProgress += 1;
      if (isActivityDone(a)) s.timesCompleted += 1;
      if (a.kind === "counter") s.totalCount += a.count;
    }
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}
