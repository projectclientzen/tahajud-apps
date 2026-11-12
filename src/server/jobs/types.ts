import type { Db } from "@/server/db";
import type { Logger } from "./log";

export const JOB_TYPES = {
  notificationSchedule: "notification_schedule",
  notificationReschedule: "notification_reschedule",
  notificationDispatch: "notification_dispatch",
  prayerSync: "prayer_sync",
  housekeeping: "housekeeping",
} as const;
export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

export type JobStatus = "queued" | "running" | "done" | "failed" | "dead";

export interface JobRow {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  run_after: Date | string;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  locked_at: Date | string | null;
  locked_by: string | null;
}

/** Throw this from a handler to say whether another try can help. Any other error counts as retryable. */
export class JobError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean = true,
  ) {
    super(message);
    this.name = "JobError";
  }
}

export interface JobContext {
  db: Db;
  now: () => Date;
  log: Logger;
  workerId: string;
  /** Epoch ms after which a long handler should stop and hand the rest to a follow-up job. */
  deadlineMs?: number;
}

/** Handlers must be safe to run twice for the same job: a lost lease can hand it to another worker. */
export type JobHandler = (job: JobRow, ctx: JobContext) => Promise<Record<string, unknown> | void>;
export type JobHandlers = Record<string, JobHandler>;
