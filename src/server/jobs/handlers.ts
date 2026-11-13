import { UUID_RE } from "@/server/db";
import { emailHandlers } from "@/server/email";
import { dispatchDue, PushNotConfiguredError } from "@/server/notifications/dispatcher";
import { scheduleAll, scheduleUser, type SchedulerDeps } from "@/server/notifications/scheduler";
import { queue } from "./queue";
import { syncPrayerTimes } from "./prayer-sync";
import type { Services } from "./services";
import { JOB_TYPES, JobError, type JobHandlers } from "./types";

const SCHEDULE_BUDGET_MS = 20_000;

/** The job types this server knows. Anything else is failed as "no handler" and never retried. */
export function buildHandlers(svc: Services): JobHandlers {
  const schedulerDeps = (): SchedulerDeps => ({
    db: svc.db,
    now: svc.now,
    log: svc.log,
    allowDemoBank: svc.config.allowDemoBank,
  });

  return {
    ...emailHandlers(svc),
    // Full sweep. Long sweeps stop at the deadline and continue in a follow-up job.
    [JOB_TYPES.notificationSchedule]: async (job, ctx) => {
      const after = typeof job.payload.after === "string" ? job.payload.after : null;
      const r = await scheduleAll(schedulerDeps(), { after, deadlineMs: ctx.deadlineMs ?? Date.now() + SCHEDULE_BUDGET_MS });
      if (r.next) await queue.enqueue(svc.db, JOB_TYPES.notificationSchedule, { after: r.next }, { dedupeKey: `sched-after:${r.next}` });
      if (r.users === 0 && r.errors > 0) throw new JobError(`notification_schedule failed for every user (${r.errors})`, true);
      return { users: r.users, errors: r.errors, ...r.totals, continued: r.next !== null };
    },

    // One user, requested by a database trigger when region, bedtime, level, preferences or subscriptions change.
    [JOB_TYPES.notificationReschedule]: async (job) => {
      const userId = job.payload.user_id;
      if (typeof userId !== "string" || !UUID_RE.test(userId)) throw new JobError("notification_reschedule needs payload.user_id", false);
      const r = await scheduleUser(schedulerDeps(), userId);
      return { ...r };
    },

    [JOB_TYPES.notificationDispatch]: async (_job, ctx) => {
      try {
        const r = await dispatchDue({
          db: svc.db,
          now: svc.now,
          log: svc.log,
          sender: svc.sender,
          senderProblem: svc.senderProblem,
          workerId: ctx.workerId,
          allowDemoBank: svc.config.allowDemoBank,
        });
        return { ...r };
      } catch (e) {
        // Missing VAPID keys do not appear by trying again. Fail now, with the reason, so the admin sees it.
        if (e instanceof PushNotConfiguredError) throw new JobError(e.message, false);
        throw e;
      }
    },

    [JOB_TYPES.prayerSync]: async () => {
      const r = await syncPrayerTimes((fn) => svc.db.asService(fn), {
        provider: svc.prayerProvider,
        providerProblem: svc.prayerProviderProblem,
        now: svc.now,
        log: svc.log,
      });
      return { ...r, failures: r.failures.length };
    },

    [JOB_TYPES.housekeeping]: async () => ({ ...(await queue.housekeeping(svc.db, svc.now())) }),
  };
}
