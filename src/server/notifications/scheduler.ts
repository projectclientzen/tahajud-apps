import { notificationPreferencesSchema, type NotificationPreferences } from "@/data/contracts";
import { PROVISIONAL_SETTINGS, type DomainSettings, type LevelNumber } from "@/domain/config/provisional";
import { selectBedtimeMessage, type SentRecord } from "@/domain/notifications/bedtime";
import { addDays, localDate, type LocalDate } from "@/domain/time/tz";
import { one, type Db, type Queryable } from "@/server/db";
import type { Logger } from "@/server/jobs/log";
import { DEMO_BEDTIME_BANK, renderBank, type BankTemplate } from "./copy";
import { planNotifications, type PlannedDay, type PlannedNotification } from "./planner";

export interface SchedulerDeps {
  db: Db;
  now: () => Date;
  log: Logger;
  /** True only outside production and only when the deployment asked for it (NOTIF_ALLOW_DEMO_BANK). */
  allowDemoBank: boolean;
  settings?: DomainSettings;
}

export interface ScheduleResult {
  created: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  /** Bedtime nights that were left out because there is no approved message bank (and no demo bank allowed). */
  bedtimeSkippedNoBank: number;
  datesWithoutSchedule: number;
  /** Why nothing was planned at all, if so. */
  idle?: "no_access" | "no_subscription" | "no_location";
}

const EMPTY: ScheduleResult = {
  created: 0,
  updated: 0,
  cancelled: 0,
  unchanged: 0,
  bedtimeSkippedNoBank: 0,
  datesWithoutSchedule: 0,
};

/** Templates of these categories are not bedtime messages (the PRD §15.2 categories are all bedtime ones). */
const NON_BEDTIME_CATEGORIES = new Set(["tahajud", "fajr", "alkahfi", "achievement"]);

interface PrayerRowJson {
  mode: "region" | "manual";
  local_date: string | null;
  fajr_at: string | null;
  maghrib_at: string | null;
  valid_until: string | null;
}

interface ExistingRow {
  id: string;
  notification_type: string;
  scheduled_at: Date | string;
  expires_at: Date | string;
  local_schedule_date: Date | string;
  status: string;
  dedupe_key: string;
  template_key: string | null;
}

const toMs = (v: Date | string): number => (v instanceof Date ? v.getTime() : Date.parse(v));
const toDateStr = (v: Date | string): string => (v instanceof Date ? v.toISOString().slice(0, 10) : v.slice(0, 10));

/** Approved, active bedtime messages. A template with a variable outside {nama} and {level} is left out. */
export async function loadBedtimeBank(q: Queryable, log: Logger, allowDemo: boolean): Promise<BankTemplate[]> {
  const rows = await q.query<{ id: string; category: string; title: string; body: string }>(
    `select id, category, title, body from public.notification_templates
     where is_active and review_status = 'published' order by id`,
  );
  const bank: BankTemplate[] = [];
  for (const r of rows) {
    if (NON_BEDTIME_CATEGORIES.has(r.category)) continue;
    const t: BankTemplate = { key: r.id, title: r.title, body: r.body, demo: false };
    try {
      renderBank(t, { nama: "x", level: 1 });
      bank.push(t);
    } catch (e) {
      log("template_invalid", { template_id: r.id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  if (bank.length === 0 && allowDemo) return [...DEMO_BEDTIME_BANK];
  return bank;
}

async function loadDays(q: Queryable, userId: string, now: Date, tz: string): Promise<Map<LocalDate, PlannedDay>> {
  const today = localDate(now, tz);
  const days = new Map<LocalDate, PlannedDay>();
  for (const date of [today, addDays(today, 1), addDays(today, 2)]) {
    const row = await one<PrayerRowJson>(q, "app_private.prayer_row_json($1::uuid, $2::timestamptz, $3::date)", [
      userId,
      now.toISOString(),
      date,
    ]);
    if (!row.fajr_at) continue;
    // Same rule as the API: an expired cache row is not a schedule.
    if (row.valid_until && now.getTime() > Date.parse(row.valid_until)) continue;
    days.set(date, {
      fajrAt: new Date(row.fajr_at),
      maghribAt: row.maghrib_at ? new Date(row.maghrib_at) : null,
    });
  }
  return days;
}

/**
 * Plans one user's notifications for the next 36 hours and brings notification_jobs in line (PRD §15.3, §15.4).
 * Idempotent: running it twice changes nothing. That is what makes "reschedule" simple: change the data, run it again.
 * - new item: inserted, `dedupe_key` unique, so two schedulers cannot double up.
 * - pending item whose time changed (region, bedtime, level, planner): moved. A skipped item whose slot is back: revived.
 * - pending item no longer wanted (type turned off, no subscription): marked skipped with reason `cancelled`.
 * - sent, expired and failed items are never touched.
 */
export async function scheduleUser(deps: SchedulerDeps, userId: string): Promise<ScheduleResult> {
  return deps.db.asService((q) => scheduleUserIn(q, deps, userId));
}

export async function scheduleUserIn(q: Queryable, deps: SchedulerDeps, userId: string): Promise<ScheduleResult> {
  const now = deps.now();
  const nowIso = now.toISOString();
  const settings = deps.settings ?? PROVISIONAL_SETTINGS;
  const result: ScheduleResult = { ...EMPTY };

  const cancelAll = async (idle: ScheduleResult["idle"]) => {
    const rows = await q.query(
      `update public.notification_jobs set status = 'skipped', skip_reason = 'cancelled', locked_until = null, locked_by = null
       where user_id = $1::uuid and status = 'pending' and scheduled_at > $2::timestamptz returning id`,
      [userId, nowIso],
    );
    return { ...result, cancelled: rows.length, idle };
  };

  const entitled = await one<boolean>(q, "app_private.has_active_entitlement($1::uuid, $2::timestamptz)", [userId, nowIso]);
  if (!entitled) return cancelAll("no_access");

  const subs = await q.query<{ n: number }>(
    `select count(*)::int as n from public.push_subscriptions s
     left join public.user_devices d on d.id = s.device_id
     where s.user_id = $1::uuid and s.is_active and (d.id is null or d.revoked_at is null)`,
    [userId],
  );
  if ((subs[0]?.n ?? 0) === 0) return cancelAll("no_subscription");

  const tz = await one<string | null>(q, "app_private.user_timezone($1::uuid)", [userId]);
  if (!tz) return cancelAll("no_location");

  const prefs: NotificationPreferences = notificationPreferencesSchema.parse(
    await one(q, "app_private.notification_prefs_json($1::uuid)", [userId]),
  );
  const level = (
    await q.query<{ current_level: number }>("select current_level from public.user_level_state where user_id = $1::uuid", [userId])
  )[0]?.current_level as LevelNumber | undefined;

  const days = await loadDays(q, userId, now, tz);
  const plan = planNotifications({ userId, now, tz, level: level ?? 1, prefs, days, settings });
  result.datesWithoutSchedule = plan.datesWithoutSchedule.length;

  const today = localDate(now, tz);
  const existing = await q.query<ExistingRow>(
    `select id, notification_type, scheduled_at, expires_at, local_schedule_date, status, dedupe_key, template_key
     from public.notification_jobs where user_id = $1::uuid and local_schedule_date >= $2::date`,
    [userId, addDays(today, -2)],
  );
  const byKey = new Map(existing.map((r) => [r.dedupe_key, r]));

  // Bedtime rotation (PRD §15.2): history = bedtime messages already sent or waiting, from the last 30 days.
  const bank = plan.items.some((i) => i.type === "bedtime") ? await loadBedtimeBank(q, deps.log, deps.allowDemoBank) : [];
  const bankByKey = new Map(bank.map((t) => [t.key, t]));
  const history = (
    await q.query<{ template_key: string; local_schedule_date: Date | string; dedupe_key: string }>(
      `select template_key, local_schedule_date, dedupe_key from public.notification_jobs
       where user_id = $1::uuid and notification_type = 'bedtime' and template_key is not null
         and status in ('pending', 'sent') and local_schedule_date >= $2::date`,
      [userId, addDays(today, -30)],
    )
  ).map((h) => ({ key: h.dedupe_key, rec: { messageId: h.template_key, sentOn: toDateStr(h.local_schedule_date) } }));
  const chosenThisRun = new Map<string, SentRecord>();

  const desired = new Set<string>();
  for (const item of plan.items) {
    const row = byKey.get(item.dedupeKey);
    let templateKey: string | null = null;
    if (item.type === "bedtime") {
      if (bank.length === 0) {
        result.bedtimeSkippedNoBank += 1;
        continue; // not desired: a pending bedtime job without a bank gets cancelled below
      }
      if (row?.template_key && bankByKey.has(row.template_key)) {
        templateKey = row.template_key;
      } else {
        const records: SentRecord[] = [
          ...history.filter((h) => h.key !== item.dedupeKey).map((h) => h.rec),
          ...[...chosenThisRun].filter(([k]) => k !== item.dedupeKey).map(([, r]) => r),
        ];
        const pick = selectBedtimeMessage(
          bank.map((t) => ({ id: t.key, template: t.body })),
          records,
          settings,
        );
        templateKey = pick?.id ?? null;
      }
      if (!templateKey) {
        result.bedtimeSkippedNoBank += 1;
        continue;
      }
      chosenThisRun.set(item.dedupeKey, { messageId: templateKey, sentOn: item.localDate });
    }
    desired.add(item.dedupeKey);
    await upsertItem(q, userId, item, row, templateKey, result);
  }

  // Pending items inside the horizon that the plan no longer has.
  const horizonEnd = now.getTime() + 36 * 3_600_000;
  const stale = existing.filter(
    (r) =>
      r.status === "pending" &&
      !desired.has(r.dedupe_key) &&
      toMs(r.scheduled_at) > now.getTime() &&
      toMs(r.scheduled_at) <= horizonEnd,
  );
  for (const r of stale) {
    await q.query(
      `update public.notification_jobs set status = 'skipped', skip_reason = 'cancelled', locked_until = null, locked_by = null
       where id = $1::uuid and status = 'pending'`,
      [r.id],
    );
    result.cancelled += 1;
  }
  return result;
}

async function upsertItem(
  q: Queryable,
  userId: string,
  item: PlannedNotification,
  row: ExistingRow | undefined,
  templateKey: string | null,
  result: ScheduleResult,
): Promise<void> {
  const isUuid = templateKey !== null && /^[0-9a-f-]{36}$/i.test(templateKey);
  const templateId = isUuid ? templateKey : null;
  if (!row) {
    const inserted = await q.query(
      `insert into public.notification_jobs
         (user_id, notification_type, scheduled_at, expires_at, local_schedule_date, template_id, template_key, status, dedupe_key)
       values ($1::uuid, $2, $3::timestamptz, $4::timestamptz, $5::date, $6::uuid, $7, 'pending', $8)
       on conflict (dedupe_key) do nothing returning id`,
      [
        userId,
        item.type,
        item.scheduledAt.toISOString(),
        item.expiresAt.toISOString(),
        item.localDate,
        templateId,
        templateKey,
        item.dedupeKey,
      ],
    );
    if (inserted.length > 0) result.created += 1;
    else result.unchanged += 1;
    return;
  }
  if (row.status !== "pending" && row.status !== "skipped") {
    result.unchanged += 1; // sent, expired, failed: history, never rewritten
    return;
  }
  const same =
    row.status === "pending" &&
    toMs(row.scheduled_at) === item.scheduledAt.getTime() &&
    toMs(row.expires_at) === item.expiresAt.getTime() &&
    (row.template_key ?? null) === templateKey;
  if (same) {
    result.unchanged += 1;
    return;
  }
  await q.query(
    `update public.notification_jobs
     set scheduled_at = $2::timestamptz, expires_at = $3::timestamptz, template_id = $4::uuid, template_key = $5,
         status = 'pending', skip_reason = null, last_error = null, locked_until = null, locked_by = null
     where id = $1::uuid and status in ('pending', 'skipped')`,
    [row.id, item.scheduledAt.toISOString(), item.expiresAt.toISOString(), templateId, templateKey],
  );
  result.updated += 1;
}

export interface SweepResult {
  users: number;
  errors: number;
  totals: Omit<ScheduleResult, "idle">;
  /** Set when the time budget ran out: pass it back as `after` to continue. */
  next: string | null;
}

/** Users who may need a plan: an active push subscription, or jobs still waiting that might have to be cancelled. */
export async function listUsersToPlan(q: Queryable, after: string | null, limit: number): Promise<string[]> {
  const rows = await q.query<{ user_id: string }>(
    `select user_id from (
       select user_id from public.push_subscriptions where is_active
       union
       select user_id from public.notification_jobs where status = 'pending'
     ) u
     where ($1::uuid is null or user_id > $1::uuid)
     order by user_id limit $2`,
    [after, limit],
  );
  return rows.map((r) => r.user_id);
}

/** Plans every user in key order. Stops early at `deadlineMs` and says where to continue. One bad user does not stop the rest. */
export async function scheduleAll(
  deps: SchedulerDeps,
  opts: { after?: string | null; pageSize?: number; deadlineMs?: number } = {},
): Promise<SweepResult> {
  const pageSize = opts.pageSize ?? 100;
  const out: SweepResult = {
    users: 0,
    errors: 0,
    totals: { created: 0, updated: 0, cancelled: 0, unchanged: 0, bedtimeSkippedNoBank: 0, datesWithoutSchedule: 0 },
    next: null,
  };
  let after = opts.after ?? null;
  for (;;) {
    const ids = await deps.db.asService((q) => listUsersToPlan(q, after, pageSize));
    if (ids.length === 0) return out;
    for (const id of ids) {
      if (opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs) {
        out.next = after;
        return out;
      }
      try {
        const r = await scheduleUser(deps, id);
        out.users += 1;
        for (const k of Object.keys(out.totals) as (keyof SweepResult["totals"])[]) out.totals[k] += r[k];
      } catch (e) {
        out.errors += 1;
        deps.log("schedule_user_failed", { user_id: id, reason: e instanceof Error ? e.message : String(e) });
      }
      after = id;
    }
    if (ids.length < pageSize) return out;
  }
}
