import { PROVISIONAL_SETTINGS, type LevelNumber } from "@/domain/config/provisional";

/** Worship duration per level and prep buffer. PROVISIONAL defaults (PRD §14.6). No contract field yet, so they stay on this device. */
export interface PlannerPrefs {
  provisional: true;
  durations: Record<LevelNumber, number>;
  bufferMinutes: number;
}

export const PLANNER_KEY = "tt-planner-prefs";
export const DURATION_RANGE = { min: 15, max: 300 } as const;
export const BUFFER_RANGE = { min: 0, max: 60 } as const;

export const defaultPlannerPrefs = (): PlannerPrefs => ({
  provisional: true,
  durations: {
    1: PROVISIONAL_SETTINGS.levels[1].estimatedDurationMinutes,
    2: PROVISIONAL_SETTINGS.levels[2].estimatedDurationMinutes,
    3: PROVISIONAL_SETTINGS.levels[3].estimatedDurationMinutes,
  },
  bufferMinutes: PROVISIONAL_SETTINGS.wakeBufferMinutes,
});

const inRange = (n: unknown, r: { min: number; max: number }): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= r.min && n <= r.max;

export function parsePlannerPrefs(raw: string | null): PlannerPrefs {
  const d = defaultPlannerPrefs();
  if (!raw) return d;
  try {
    const v = JSON.parse(raw) as Partial<PlannerPrefs>;
    for (const l of [1, 2, 3] as const) if (inRange(v.durations?.[l], DURATION_RANGE)) d.durations[l] = v.durations![l];
    if (inRange(v.bufferMinutes, BUFFER_RANGE)) d.bufferMinutes = v.bufferMinutes;
  } catch {
    /* corrupt value: keep defaults */
  }
  return d;
}

export function readPlannerPrefs(): PlannerPrefs {
  try {
    return parsePlannerPrefs(window.localStorage.getItem(PLANNER_KEY));
  } catch {
    return defaultPlannerPrefs();
  }
}

export function writePlannerPrefs(p: PlannerPrefs): void {
  window.localStorage.setItem(PLANNER_KEY, JSON.stringify(p));
}
