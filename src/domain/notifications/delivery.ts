import { PROVISIONAL_SETTINGS, type DomainSettings, type NotificationType } from "../config/provisional";
import { localMinutes, parseClock, type LocalDate } from "../time/tz";

export const dedupeKey = (userId: string, type: NotificationType, localDate: LocalDate): string =>
  `${userId}:${type}:${localDate}`;

/** A job is expired once `now` passes scheduled time + the type's expiry (PRD §15.1, NOTIF-04). */
export function isExpired(
  type: NotificationType,
  scheduledAt: Date,
  now: Date,
  settings: DomainSettings = PROVISIONAL_SETTINGS,
): boolean {
  return now.getTime() > scheduledAt.getTime() + settings.notificationExpiryMinutes[type] * 60_000;
}

export interface QuietHours {
  enabled: boolean;
  /** "HH:MM" local. May wrap midnight (22:00-04:00). */
  start: string;
  end: string;
  /** User chose to still receive tahajud and fajr during quiet hours (PRD §15.4). */
  allowWorship: boolean;
}

export function isInQuietHours(at: Date, tz: string, q: QuietHours): boolean {
  if (!q.enabled) return false;
  const s = parseClock(q.start);
  const e = parseClock(q.end);
  const start = s.hour * 60 + s.minute;
  const end = e.hour * 60 + e.minute;
  const t = localMinutes(at, tz);
  if (start === end) return false;
  return start < end ? t >= start && t < end : t >= start || t < end;
}

export type SkipReason = "expired" | "quiet_hours" | "disabled";
export type SendDecision = { send: true } | { send: false; reason: SkipReason };

export interface JobCheck {
  type: NotificationType;
  scheduledAt: Date;
  now: Date;
  tz: string;
  typeEnabled: boolean;
  quiet: QuietHours;
}

/** Final gate before a push goes out: enabled, not expired, not in quiet hours (NOTIF-02, -04, -05). */
export function decideSend(job: JobCheck, settings: DomainSettings = PROVISIONAL_SETTINGS): SendDecision {
  if (!job.typeEnabled) return { send: false, reason: "disabled" };
  if (isExpired(job.type, job.scheduledAt, job.now, settings)) return { send: false, reason: "expired" };
  const worship = job.type === "tahajud" || job.type === "fajr";
  if (isInQuietHours(job.scheduledAt, job.tz, job.quiet) && !(worship && job.quiet.allowWorship)) {
    return { send: false, reason: "quiet_hours" };
  }
  return { send: true };
}
