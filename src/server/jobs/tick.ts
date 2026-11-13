import { one } from "@/server/db";
import { buildHandlers } from "./handlers";
import { queue } from "./queue";
import { runJobs, type RunOptions, type RunSummary } from "./runner";
import type { Services } from "./services";
import { JOB_TYPES } from "./types";

/** How often each recurring job is created (seconds). Dispatch is also gated on there being something due. */
export const RECURRING = {
  /** Plans every user's next 36 hours. Per-user changes are planned sooner by notification_reschedule. */
  notificationSchedule: 15 * 60,
  dispatch: 60,
  /** While push is not configured a due notification would fail every minute. Once per quarter hour is enough to be seen. */
  dispatchUnconfigured: 15 * 60,
  prayerSync: 6 * 3600,
  housekeeping: 24 * 3600,
} as const;

export interface TickResult {
  enqueued: string[];
  run: RunSummary;
}

/**
 * One turn of the clock, for whoever triggers it (worker loop, cron endpoint). Safe to call from many places at once:
 * recurring jobs are created under an advisory lock and each job is claimed by exactly one worker.
 */
export async function tick(svc: Services, opts: RunOptions = {}): Promise<TickResult> {
  const now = svc.now();
  const enqueued: string[] = [];
  const add = async (type: string, every: number) => {
    if (await queue.enqueueRecurring(svc.db, type, every, now)) enqueued.push(type);
  };

  await add(JOB_TYPES.notificationSchedule, RECURRING.notificationSchedule);
  await add(JOB_TYPES.prayerSync, RECURRING.prayerSync);
  await add(JOB_TYPES.housekeeping, RECURRING.housekeeping);

  const due = await svc.db.asService((q) =>
    one<boolean>(q, "exists (select 1 from public.notification_jobs where status = 'pending' and scheduled_at <= $1::timestamptz)", [now.toISOString()]),
  );
  if (due) await add(JOB_TYPES.notificationDispatch, svc.sender ? RECURRING.dispatch : RECURRING.dispatchUnconfigured);

  const run = await runJobs(
    { db: svc.db, now: svc.now, log: svc.log, workerId: svc.workerId, deadlineMs: opts.deadlineMs },
    buildHandlers(svc),
    opts,
  );
  return { enqueued, run };
}
