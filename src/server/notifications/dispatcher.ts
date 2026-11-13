import { notificationPreferencesSchema, type NotificationPreferences } from "@/data/contracts";
import { PROVISIONAL_SETTINGS, type DomainSettings, type NotificationType } from "@/domain/config/provisional";
import { decideSend, type SkipReason } from "@/domain/notifications/delivery";
import { one, type Db, type Queryable } from "@/server/db";
import type { Logger } from "@/server/jobs/log";
import type { PushSender, PushSubscriptionRecord } from "@/server/push";
import {
  DEFAULT_COPY,
  DEMO_BEDTIME_BANK,
  NOTIFICATION_URL,
  firstName,
  isDemoKey,
  renderBank,
  type BankTemplate,
  type NotificationContent,
} from "./copy";

export interface DispatchDeps {
  db: Db;
  now: () => Date;
  log: Logger;
  /** Null when VAPID keys are missing. Then nothing is claimed and the run fails with a clear message. */
  sender: PushSender | null;
  /** Why `sender` is null, in words for the person setting up the server. */
  senderProblem?: string;
  workerId: string;
  allowDemoBank: boolean;
  settings?: DomainSettings;
  /** Retries of one notification after a failed send, before it is marked failed. */
  maxSendAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface DispatchResult {
  expired: number;
  claimed: number;
  sent: number;
  skipped: Record<string, number>;
  failed: number;
  retried: number;
  deactivated: number;
}

interface ClaimedJob {
  id: string;
  user_id: string;
  notification_type: NotificationType;
  scheduled_at: Date | string;
  expires_at: Date | string;
  template_key: string | null;
  attempt_count: number;
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

export class PushNotConfiguredError extends Error {
  readonly code = "PUSH_NOT_CONFIGURED";
}

/** Prefs gate for one type. Achievement is not sent by the scheduler yet but the switch is honoured. */
function typeEnabled(prefs: NotificationPreferences, type: NotificationType): boolean {
  return prefs[type].enabled;
}

async function loadTemplate(q: Queryable, key: string, allowDemo: boolean): Promise<BankTemplate | null> {
  if (isDemoKey(key)) {
    if (!allowDemo) return null;
    return DEMO_BEDTIME_BANK.find((t) => t.key === key) ?? null;
  }
  const rows = await q.query<{ id: string; title: string; body: string }>(
    `select id, title, body from public.notification_templates where id = $1::uuid and is_active and review_status = 'published'`,
    [key],
  );
  const r = rows[0];
  return r ? { key: r.id, title: r.title, body: r.body, demo: false } : null;
}

/**
 * Sends what is due. Order of safety checks for each notification (PRD §15.4):
 * 1. Past its expiry: never sent (NOTIF-04). Done in SQL for everything first, so a late worker cannot send stale pushes.
 * 2. No active access, type switched off, or inside quiet hours: skipped (NOTIF-02, NOTIF-05).
 * 3. No usable subscription: skipped. A 404/410 from the push service turns that subscription off.
 * Push is best effort: a failed send is retried a few times inside the expiry window, then marked failed.
 */
export async function dispatchDue(deps: DispatchDeps): Promise<DispatchResult> {
  const result: DispatchResult = { expired: 0, claimed: 0, sent: 0, skipped: {}, failed: 0, retried: 0, deactivated: 0 };
  const settings = deps.settings ?? PROVISIONAL_SETTINGS;
  const now = deps.now();
  const nowIso = now.toISOString();

  result.expired = await deps.db.asService((q) =>
    one<number>(q, "app_private.notif_expire_overdue($1::timestamptz)", [nowIso]),
  );

  if (!deps.sender) {
    // Only complain when there is something that could have been sent.
    const due = await deps.db.asService((q) =>
      q.query<{ n: number }>(
        `select count(*)::int as n from public.notification_jobs where status = 'pending' and scheduled_at <= $1::timestamptz`,
        [nowIso],
      ),
    );
    if ((due[0]?.n ?? 0) > 0) {
      throw new PushNotConfiguredError(deps.senderProblem ?? "Web Push is not configured (VAPID keys missing).");
    }
    return result;
  }
  const sender = deps.sender;

  const claimed = await deps.db.asService((q) =>
    q.query<ClaimedJob>("select * from app_private.notif_claim_due($1, 50, 120, $2::timestamptz)", [deps.workerId, nowIso]),
  );
  result.claimed = claimed.length;

  const skip = async (job: ClaimedJob, status: "skipped" | "expired", reason: string) => {
    await deps.db.asService((q) =>
      q.query("select app_private.notif_finish($1::uuid, $2, $3, $4, null, null, $5::timestamptz)", [
        job.id,
        deps.workerId,
        status,
        reason,
        nowIso,
      ]),
    );
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  };

  for (const job of claimed) {
    try {
      await handleOne(job);
    } catch (e) {
      // Whatever went wrong, this notification must not block the others, and must not be retried forever.
      const msg = e instanceof Error ? e.message : String(e);
      deps.log("notification_error", { job_id: job.id, type: job.notification_type, reason: msg });
      await deps.db.asService((q) =>
        q.query("select app_private.notif_finish($1::uuid, $2, 'failed', null, $3, null, $4::timestamptz)", [
          job.id,
          deps.workerId,
          msg,
          nowIso,
        ]),
      );
      result.failed += 1;
    }
  }
  return result;

  async function handleOne(job: ClaimedJob): Promise<void> {
    const type = job.notification_type;
    const scheduledAt = toDate(job.scheduled_at);
    const expiresAt = toDate(job.expires_at);

    const ctx = await deps.db.asService(async (q) => {
      const entitled = await one<boolean>(q, "app_private.has_active_entitlement($1::uuid, $2::timestamptz)", [
        job.user_id,
        nowIso,
      ]);
      const tz = await one<string | null>(q, "app_private.user_timezone($1::uuid)", [job.user_id]);
      const prefs = notificationPreferencesSchema.parse(
        await one(q, "app_private.notification_prefs_json($1::uuid)", [job.user_id]),
      );
      const profile = (
        await q.query<{ display_name: string | null }>("select display_name from public.profiles where user_id = $1::uuid", [
          job.user_id,
        ])
      )[0];
      const level =
        (
          await q.query<{ current_level: number }>(
            "select current_level from public.user_level_state where user_id = $1::uuid",
            [job.user_id],
          )
        )[0]?.current_level ?? 1;
      const subs = await q.query<PushSubscriptionRecord>(
        `select s.id, s.endpoint, s.p256dh, s.auth from public.push_subscriptions s
         left join public.user_devices d on d.id = s.device_id
         where s.user_id = $1::uuid and s.is_active and (d.id is null or d.revoked_at is null)
         order by s.created_at, s.id`,
        [job.user_id],
      );
      const template = type === "bedtime" && job.template_key ? await loadTemplate(q, job.template_key, deps.allowDemoBank) : null;
      return { entitled, tz, prefs, name: profile?.display_name ?? null, level, subs, template };
    });

    if (!ctx.entitled) return skip(job, "skipped", "no_access");
    if (expiresAt.getTime() < now.getTime()) return skip(job, "expired", "expired");
    const decision = decideSend(
      {
        type,
        scheduledAt,
        now,
        tz: ctx.tz ?? "Asia/Jakarta",
        typeEnabled: typeEnabled(ctx.prefs, type),
        quiet: {
          enabled: ctx.prefs.quiet_hours.enabled,
          start: ctx.prefs.quiet_hours.start,
          end: ctx.prefs.quiet_hours.end,
          allowWorship: ctx.prefs.quiet_hours.allow_worship,
        },
      },
      settings,
    );
    if (!decision.send) return skip(job, decision.reason === "expired" ? "expired" : "skipped", reasonName(decision.reason));
    if (ctx.subs.length === 0) return skip(job, "skipped", "no_subscription");

    let content: NotificationContent;
    if (type === "bedtime") {
      if (!job.template_key) return skip(job, "skipped", "template_unavailable");
      if (isDemoKey(job.template_key) && !deps.allowDemoBank) return skip(job, "skipped", "demo_not_allowed");
      if (!ctx.template) return skip(job, "skipped", "template_unavailable");
      content = renderBank(ctx.template, { nama: firstName(ctx.name), level: ctx.level });
    } else {
      const copy = DEFAULT_COPY[type];
      if (!copy) return skip(job, "skipped", "no_content");
      content = copy;
    }

    const ttlSeconds = Math.max(1, Math.min(settings.notificationExpiryMinutes[type] * 60, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)));
    let delivered = 0;
    let transientFailures = 0;
    let hardFailures = 0;
    for (const sub of ctx.subs) {
      const out = await sender.send(
        sub,
        { type, title: content.title, body: content.body, url: NOTIFICATION_URL[type], tag: `${type}-${scheduledAt.toISOString().slice(0, 10)}` },
        { ttlSeconds },
      );
      const code = "statusCode" in out ? out.statusCode : null;
      await deps.db.asService(async (q) => {
        await q.query(
          `insert into public.notification_deliveries (job_id, subscription_id, delivery_status, attempted_at, provider_status_code)
           values ($1::uuid, $2::uuid, $3, $4::timestamptz, $5)`,
          [job.id, sub.id, out.status, nowIso, code],
        );
        if (out.status === "sent") {
          await q.query(
            "update public.push_subscriptions set last_success_at = $2::timestamptz, failure_count = 0 where id = $1::uuid",
            [sub.id, nowIso],
          );
        } else if (out.status === "deactivate") {
          await q.query("update public.push_subscriptions set is_active = false where id = $1::uuid", [sub.id]);
        } else {
          await q.query("update public.push_subscriptions set failure_count = failure_count + 1 where id = $1::uuid", [sub.id]);
        }
      });
      if (out.status === "sent") delivered += 1;
      else if (out.status === "deactivate") result.deactivated += 1;
      else if (out.statusCode !== null && out.statusCode < 500 && out.statusCode !== 429) hardFailures += 1;
      else transientFailures += 1;
    }

    const finish = (status: string, reason: string | null, error: string | null, retryAfter: number | null) =>
      deps.db.asService((q) =>
        q.query("select app_private.notif_finish($1::uuid, $2, $3, $4, $5, $6, $7::timestamptz)", [
          job.id,
          deps.workerId,
          status,
          reason,
          error,
          retryAfter,
          nowIso,
        ]),
      );

    if (delivered > 0) {
      await finish("sent", null, null, null);
      result.sent += 1;
    } else if (transientFailures > 0 && job.attempt_count < (deps.maxSendAttempts ?? 3)) {
      // Back to pending: the next dispatch run (after the lease) tries again, and expiry still applies.
      await finish("pending", null, "push service unavailable, will retry", 60 * job.attempt_count);
      result.retried += 1;
    } else if (transientFailures + hardFailures > 0) {
      await finish("failed", null, "push delivery failed", null);
      result.failed += 1;
    } else {
      // Every subscription answered 404/410: the device is gone.
      await finish("skipped", "subscriptions_gone", null, null);
      result.skipped.subscriptions_gone = (result.skipped.subscriptions_gone ?? 0) + 1;
    }
  }
}

function reasonName(r: SkipReason): string {
  return r === "quiet_hours" ? "quiet_hours" : r === "disabled" ? "disabled" : "expired";
}
