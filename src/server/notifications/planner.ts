import type { NotificationPreferences } from "@/data/contracts";
import { PROVISIONAL_SETTINGS, type DomainSettings, type LevelNumber, type NotificationType } from "@/domain/config/provisional";
import { dedupeKey } from "@/domain/notifications/delivery";
import { planWake } from "@/domain/prayer/wake-plan";
import { addDays, localDate, parseClock, weekdayOf, zonedInstant, type LocalDate } from "@/domain/time/tz";

/** Pure planning of what to send in the next 36 hours (PRD §15.3). No clock, no database: callers pass everything in. */
export const HORIZON_HOURS = 36;

export interface PlannedDay {
  fajrAt: Date;
  maghribAt: Date | null;
}

export interface PlanInput {
  userId: string;
  now: Date;
  /** Effective timezone: the region's, or the manual schedule's (PRD BUG-14). */
  tz: string;
  level: LevelNumber;
  prefs: NotificationPreferences;
  /** Schedule per local Fajr date. A missing date means no known schedule for it. */
  days: ReadonlyMap<LocalDate, PlannedDay>;
  horizonHours?: number;
  settings?: DomainSettings;
}

export interface PlannedNotification {
  type: NotificationType;
  scheduledAt: Date;
  expiresAt: Date;
  /** The Fajr date of the night this belongs to. For Al-Kahfi: the Friday. */
  localDate: LocalDate;
  dedupeKey: string;
  /** Seconds a push service may hold the message: never past the expiry (PRD §15.1). */
  ttlSeconds: number;
}

export interface Plan {
  items: PlannedNotification[];
  /** Fajr dates in the horizon that had no schedule. Tahajud, Fajr and bedtime cannot be planned for them. */
  datesWithoutSchedule: LocalDate[];
}

const MIN = 60_000;

/**
 * Everything that is due after `now` and up to `now + horizon`, for the types the user turned on.
 * - tahajud: the wake time from the wake planner (fajr - level duration - buffer).
 * - fajr: the Fajr instant.
 * - bedtime: the latest time before the wake-up whose wall clock equals the user's target sleep time, minus the offset.
 *   (A target after midnight, say 01:00, therefore lands on the Fajr date itself, not 27 hours earlier.)
 * - alkahfi: Thursday Maghrib, or the fallback clock time when no Maghrib is known. Dated by the Friday it is for.
 * Times that already passed are not planned: late starts are the dispatcher's concern (expiry), not the planner's.
 */
export function planNotifications(input: PlanInput): Plan {
  const settings = input.settings ?? PROVISIONAL_SETTINGS;
  const horizonEnd = input.now.getTime() + (input.horizonHours ?? HORIZON_HOURS) * 60 * MIN;
  const today = localDate(input.now, input.tz);
  const dates = [today, addDays(today, 1), addDays(today, 2)];
  const items: PlannedNotification[] = [];
  const missing: LocalDate[] = [];

  const add = (type: NotificationType, scheduledAt: Date, date: LocalDate) => {
    const t = scheduledAt.getTime();
    if (!(t > input.now.getTime() && t <= horizonEnd)) return;
    const expiryMinutes = settings.notificationExpiryMinutes[type];
    items.push({
      type,
      scheduledAt,
      expiresAt: new Date(t + expiryMinutes * MIN),
      localDate: date,
      dedupeKey: dedupeKey(input.userId, type, date),
      ttlSeconds: expiryMinutes * 60,
    });
  };

  for (const date of dates) {
    const day = input.days.get(date);
    if (!day) {
      // A date that starts after the horizon does not matter.
      if (zonedInstant(addDays(date, -1), 12, 0, input.tz).getTime() <= horizonEnd) missing.push(date);
    } else {
      const wake = planWake({ fajrAt: day.fajrAt, level: input.level }, settings).wakeAt;
      if (input.prefs.tahajud.enabled) add("tahajud", wake, date);
      if (input.prefs.fajr.enabled) add("fajr", day.fajrAt, date);
      if (input.prefs.bedtime.enabled) {
        const c = parseClock(input.prefs.bedtime.target_sleep_time);
        let sleepAt = zonedInstant(date, c.hour, c.minute, input.tz);
        if (sleepAt.getTime() > wake.getTime()) sleepAt = zonedInstant(addDays(date, -1), c.hour, c.minute, input.tz);
        add("bedtime", new Date(sleepAt.getTime() - input.prefs.bedtime.offset_minutes * MIN), date);
      }
    }
    if (input.prefs.alkahfi.enabled && weekdayOf(date) === 4) {
      const fb = parseClock(settings.alKahfiFallbackMaghrib);
      const start = day?.maghribAt ?? zonedInstant(date, fb.hour, fb.minute, input.tz);
      add("alkahfi", start, addDays(date, 1));
    }
  }

  items.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime() || a.type.localeCompare(b.type));
  return { items, datesWithoutSchedule: missing };
}
