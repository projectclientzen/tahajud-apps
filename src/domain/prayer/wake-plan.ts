import { PROVISIONAL_SETTINGS, type DomainSettings, type LevelNumber } from "../config/provisional";

const MIN_MS = 60_000;

export interface WakePlanInput {
  fajrAt: Date;
  level: LevelNumber;
  /** Overrides the level default, minutes. */
  durationMinutes?: number;
  bufferMinutes?: number;
  /** Planned bedtime. Needed only for the sleep warning. */
  sleepAt?: Date | null;
}

export interface WakePlan {
  wakeAt: Date;
  durationMinutes: number;
  bufferMinutes: number;
  sleepHours: number | null;
  /** Neutral suggestion, or null when sleep is enough or unknown (PRD §14.6). */
  sleepWarning: string | null;
}

/** wake = fajr - duration - buffer. Warns when planned sleep is under the threshold. */
export function planWake(input: WakePlanInput, settings: DomainSettings = PROVISIONAL_SETTINGS): WakePlan {
  const durationMinutes = input.durationMinutes ?? settings.levels[input.level].estimatedDurationMinutes;
  const bufferMinutes = input.bufferMinutes ?? settings.wakeBufferMinutes;
  const wakeAt = new Date(input.fajrAt.getTime() - (durationMinutes + bufferMinutes) * MIN_MS);
  if (!input.sleepAt) return { wakeAt, durationMinutes, bufferMinutes, sleepHours: null, sleepWarning: null };
  const sleepHours = (wakeAt.getTime() - input.sleepAt.getTime()) / (60 * MIN_MS);
  const short = sleepHours < settings.minSleepHours;
  const rounded = Math.max(0, Math.round(sleepHours));
  return {
    wakeAt,
    durationMinutes,
    bufferMinutes,
    sleepHours,
    sleepWarning: short
      ? `Jadwalmu menyisakan sekitar ${rounded} jam tidur. Mau coba tidur lebih awal atau memakai durasi ibadah yang lebih singkat?`
      : null,
  };
}
