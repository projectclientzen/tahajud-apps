import { addDays, localDate, parseClock, planWake, zonedInstant, type LevelNumber } from "@/domain";
import type { PlannerPrefs } from "./planner-prefs";

/** Preview of the wake time with the user's own durations. Uses the domain planner, so the warning text stays neutral. */
export function buildPlannerPreview(input: {
  fajrAt: Date;
  tz: string;
  level: LevelNumber;
  prefs: PlannerPrefs;
  targetSleep: string;
}) {
  const { fajrAt, tz, level, prefs, targetSleep } = input;
  const base = planWake({
    fajrAt,
    level,
    durationMinutes: prefs.durations[level],
    bufferMinutes: prefs.bufferMinutes,
  });
  const { hour, minute } = parseClock(targetSleep);
  const fajrDay = localDate(fajrAt, tz);
  let sleepAt = zonedInstant(fajrDay, hour, minute, tz);
  if (sleepAt.getTime() >= base.wakeAt.getTime()) sleepAt = zonedInstant(addDays(fajrDay, -1), hour, minute, tz);
  return planWake({
    fajrAt,
    level,
    durationMinutes: prefs.durations[level],
    bufferMinutes: prefs.bufferMinutes,
    sleepAt,
  });
}
