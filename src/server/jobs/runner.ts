import { backoffSeconds } from "./backoff";
import { queue } from "./queue";
import { JobError, type JobContext, type JobHandlers, type JobRow } from "./types";

export interface RunOptions {
  /** Jobs claimed per round trip. */
  batch?: number;
  /** A "running" job older than this is assumed lost and given to another worker. */
  leaseSeconds?: number;
  /** Stop claiming new jobs after this instant (epoch ms). A job already started finishes. */
  deadlineMs?: number;
  /** Safety cap per call. */
  maxJobs?: number;
}

export interface RunSummary {
  claimed: number;
  done: number;
  retried: number;
  failed: number;
  dead: number;
  ignored: number;
  byType: Record<string, number>;
}

/** Claims due jobs and runs them one at a time until nothing is due, the deadline passes, or maxJobs is reached. */
export async function runJobs(ctx: JobContext, handlers: JobHandlers, opts: RunOptions = {}): Promise<RunSummary> {
  const batch = opts.batch ?? 5;
  const lease = opts.leaseSeconds ?? 300;
  const maxJobs = opts.maxJobs ?? 50;
  const out: RunSummary = { claimed: 0, done: 0, retried: 0, failed: 0, dead: 0, ignored: 0, byType: {} };

  while (out.claimed < maxJobs && !(opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs)) {
    const jobs = await queue.claim(ctx.db, ctx.workerId, Math.min(batch, maxJobs - out.claimed), lease, ctx.now());
    if (jobs.length === 0) break;
    for (const job of jobs) {
      out.claimed += 1;
      out.byType[job.job_type] = (out.byType[job.job_type] ?? 0) + 1;
      await runOne(ctx, handlers, job, out);
    }
  }
  return out;
}

async function runOne(ctx: JobContext, handlers: JobHandlers, job: JobRow, out: RunSummary): Promise<void> {
  const handler = handlers[job.job_type];
  try {
    if (!handler) throw new JobError(`No handler for job type "${job.job_type}"`, false);
    const result = await handler(job, ctx);
    const ok = await queue.complete(ctx.db, job.id, ctx.workerId, ctx.now());
    if (ok) out.done += 1;
    else out.ignored += 1; // the lease ran out and another worker owns it now
    ctx.log("job_done", { job_id: job.id, type: job.job_type, attempt: job.attempt_count, ...(result ?? {}) });
  } catch (e) {
    const retryable = e instanceof JobError ? e.retryable : true;
    const message = e instanceof Error ? e.message : String(e);
    const status = await queue.fail(ctx.db, job.id, ctx.workerId, message, backoffSeconds(job.attempt_count), retryable, ctx.now());
    if (status === "queued") out.retried += 1;
    else if (status === "dead") out.dead += 1;
    else if (status === "failed") out.failed += 1;
    else out.ignored += 1;
    ctx.log("job_error", { job_id: job.id, type: job.job_type, attempt: job.attempt_count, outcome: status, reason: message });
  }
}
