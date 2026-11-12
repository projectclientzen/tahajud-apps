import type { LevelNumber } from "../config/provisional";
import type { SessionStatus } from "../content/session-status";
import { toDisplayStatus } from "../session/state-machine";
import { computeSessionStatus, hasProgress, type ActivityProgress } from "../session/status";
import { dateRange, diffDays, type LocalDate } from "../time/tz";

/** One stored session row with its frozen level and activity progress. */
export interface SessionRecord {
  sessionKey: LocalDate;
  level: LevelNumber;
  activities: ActivityProgress[];
}

export interface CalendarDay {
  date: LocalDate;
  status: SessionStatus;
  /** Snapshot level, or null when no session row exists for that date. */
  level: LevelNumber | null;
  hasProgress: boolean;
}

export interface CalendarInput {
  programStartDate: LocalDate;
  /** `activeSessionKey(now)`: dates before it are closed, it is still upcoming. */
  activeKey: LocalDate;
  records: readonly SessionRecord[];
  excusedDates: readonly LocalDate[];
  /** Optional clamp. Days before `programStartDate` or after `activeKey` are never produced. */
  from?: LocalDate;
  to?: LocalDate;
}

/**
 * Calendar from program start to the active session (PRD §10.4).
 * Missed is derived: a closed date with no row, or no progress, that is not excused.
 */
export function buildCalendar(input: CalendarInput): CalendarDay[] {
  const { programStartDate, activeKey } = input;
  if (diffDays(programStartDate, activeKey) < 0) return [];
  const start = input.from && diffDays(programStartDate, input.from) > 0 ? input.from : programStartDate;
  const end = input.to && diffDays(input.to, activeKey) > 0 ? input.to : activeKey;
  const byKey = new Map(input.records.map((r) => [r.sessionKey, r]));
  const excused = new Set(input.excusedDates);
  return dateRange(start, end).map((date) => {
    const rec = byKey.get(date);
    const activities = rec?.activities ?? [];
    const state = computeSessionStatus({
      activities,
      excused: excused.has(date),
      closed: date < activeKey,
    });
    return {
      date,
      status: toDisplayStatus(state),
      level: rec?.level ?? null,
      hasProgress: activities.some(hasProgress),
    };
  });
}
