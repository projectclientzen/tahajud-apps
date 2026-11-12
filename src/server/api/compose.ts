import type { CalendarDay } from "@/domain/calendar/calendar";
import { PROVISIONAL_SETTINGS, type LevelNumber } from "@/domain/config/provisional";
import { chooseSchedule, type PrayerSchedule } from "@/domain/prayer/schedule";
import { planWake } from "@/domain/prayer/wake-plan";
import type { LevelProgress } from "@/domain/progression/progression";
import { pickInsight } from "@/domain/reporting/insight";
import { addDays, localDate, parseClock, zonedInstant } from "@/domain/time/tz";
import {
  dashboardSchema,
  prayerTimeSchema,
  reportResponseSchema,
  wakePlanSchema,
  type Dashboard,
  type NotificationPreferences,
  type PrayerTime,
  type ReportResponse,
  type WakePlan,
} from "@/data/contracts";
import { one, type Queryable } from "@/server/db";

/** Prayer row as the SQL function returns it (get_prayer_row). */
export interface PrayerRow {
  mode: "region" | "manual";
  local_date: string | null;
  region_id: string | null;
  region_name: string | null;
  timezone: string | null;
  fajr_at: string | null;
  maghrib_at: string | null;
  fetched_at: string | null;
  valid_until: string | null;
  /** Only region rows can have these. Manual and missing rows leave them out. */
  verification?: "verified" | "needs_review" | "unchecked" | null;
  attribution?: string | null;
}

/**
 * PrayerTime for the API (PRD §14.5, §19.3). The database holds the cached provider rows and the user's manual times.
 * The schedule rules are the same domain function the mock uses. Nothing is invented: no row means "not available".
 * The API never calls a provider itself, so `source` is "provider" or "manual" here ("cached" needs a live provider call).
 */
export function buildPrayerTime(row: PrayerRow, now: Date): PrayerTime {
  const tz = row.timezone ?? "Asia/Jakarta";
  const date = row.local_date ?? localDate(now, tz);
  const none: PrayerTime = {
    available: false,
    region_id: row.region_id,
    region_name: row.region_name,
    local_date: date,
    timezone: tz,
    fajr_at: null,
    maghrib_at: null,
    source: null,
    cache_status: "none",
    fetched_at: null,
    label: null,
    demo_note: null,
  };
  if (!row.fajr_at) return prayerTimeSchema.parse(none);
  const sched: PrayerSchedule = {
    regionId: row.region_id,
    localDate: date,
    timezone: tz,
    fajrAt: row.fajr_at,
    maghribAt: row.maghrib_at,
    source: row.mode === "manual" ? "manual" : "provider",
    fetchedAt: row.fetched_at,
    validUntil: row.valid_until,
  };
  const stillValid = sched.validUntil === null || now.getTime() <= Date.parse(sched.validUntil);
  const choice = chooseSchedule({
    mode: row.mode,
    provider: row.mode === "region" && stillValid ? sched : null,
    cached: null,
    manual: row.mode === "manual" ? sched : null,
    date,
    now,
  });
  if (!choice.ok) return prayerTimeSchema.parse(none);
  const s = choice.schedule;
  return prayerTimeSchema.parse({
    available: true,
    region_id: s.regionId,
    region_name: row.region_name,
    local_date: date,
    timezone: s.timezone,
    fajr_at: s.fajrAt,
    maghrib_at: s.maghribAt,
    source: s.source,
    cache_status: s.source === "cached" ? "cached" : "fresh",
    fetched_at: s.fetchedAt,
    label: choice.label,
    demo_note: null,
    // Provider cross-check and attribution, as the job stored them. A manual schedule has neither.
    verification: s.source === "manual" ? null : (row.verification ?? null),
    attribution: s.source === "manual" ? null : (row.attribution ?? null),
  });
}

export async function getPrayerTime(q: Queryable, now: Date): Promise<PrayerTime> {
  return buildPrayerTime(await one<PrayerRow>(q, "public.get_prayer_row()"), now);
}

export async function getWakePlan(q: Queryable, now: Date): Promise<WakePlan> {
  const [{ level }, pt, prefs] = await Promise.all([
    one<{ level: LevelNumber }>(q, "public.get_current_level()"),
    getPrayerTime(q, now),
    one<NotificationPreferences>(q, "public.get_notification_prefs()"),
  ]);
  const s = PROVISIONAL_SETTINGS;
  const fallback = {
    level,
    duration_minutes: s.levels[level].estimatedDurationMinutes,
    buffer_minutes: s.wakeBufferMinutes,
  };
  if (!pt.available || !pt.fajr_at) {
    return wakePlanSchema.parse({
      ...fallback,
      wake_at: null,
      fajr_at: null,
      sleep_hours: null,
      sleep_warning: null,
      source: null,
    });
  }
  const bed = parseClock(prefs.bedtime.target_sleep_time);
  const sleepAt = prefs.bedtime.enabled
    ? zonedInstant(addDays(pt.local_date, -1), bed.hour, bed.minute, pt.timezone)
    : null;
  const plan = planWake({ fajrAt: new Date(pt.fajr_at), level, sleepAt }, s);
  return wakePlanSchema.parse({
    level,
    wake_at: plan.wakeAt.toISOString(),
    fajr_at: pt.fajr_at,
    duration_minutes: plan.durationMinutes,
    buffer_minutes: plan.bufferMinutes,
    sleep_hours: plan.sleepHours,
    sleep_warning: plan.sleepWarning,
    source: pt.source,
  });
}

interface LevelProgressJson {
  levels: {
    level: LevelNumber;
    completed: number;
    required: number;
    ratio: number;
    unlocked: boolean;
    is_current: boolean;
  }[];
}
interface CalendarJson {
  days: { date: string; status: CalendarDay["status"]; level: LevelNumber | null; has_progress: boolean }[];
}

/** The insight text comes from the domain templates, over the full calendar (PRD §22.4). Null when there is nothing honest to say. */
async function insightFor(q: Queryable, lp: LevelProgressJson) {
  const cal = await one<CalendarJson>(q, "public.get_calendar()");
  // The calendar ends at the active session, so its last day is the active key.
  const activeKey = cal.days.at(-1)?.date;
  if (!activeKey) return null;
  const days: CalendarDay[] = cal.days.map((d) => ({
    date: d.date,
    status: d.status,
    level: d.level,
    hasProgress: d.has_progress,
  }));
  const levels: LevelProgress[] = lp.levels.map((l) => ({
    level: l.level,
    completed: l.completed,
    required: l.required,
    ratio: l.ratio,
    unlocked: l.unlocked,
    isCurrent: l.is_current,
  }));
  return pickInsight({ days, activeKey, levels });
}

/** Dashboard: the database part, plus prayer time and insight (PRD §19.5). Reads only. */
export async function getDashboard(q: Queryable, now: Date): Promise<Dashboard> {
  const base = await one<Omit<Dashboard, "prayer_time" | "insight"> & { setup_cards: Dashboard["setup_cards"] }>(
    q,
    "public.get_dashboard()",
  );
  const prayer_time = await getPrayerTime(q, now);
  const insight = await insightFor(q, base.level_progress);
  return dashboardSchema.parse({
    ...base,
    prayer_time,
    insight,
    // The server cannot know whether the app is installed. The browser tells the dashboard (display-mode), so this stays false here.
    setup_cards: [...base.setup_cards, { key: "install_app", done: false }],
  });
}

export async function getReport(q: Queryable, period: 7 | 30 | 90): Promise<ReportResponse> {
  const base = await one<Omit<ReportResponse, "insight">>(q, "public.get_report($1::int)", [period]);
  const lp = await one<LevelProgressJson>(q, "public.get_level_progress()");
  return reportResponseSchema.parse({ ...base, insight: await insightFor(q, lp) });
}
