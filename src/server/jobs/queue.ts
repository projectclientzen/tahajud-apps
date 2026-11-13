import { one, type Db } from "@/server/db";
import type { JobRow } from "./types";

/** Thin wrappers over app_private.jobs_* (migration 20261115b). Every call is one short transaction as service_role. */
export const queue = {
  enqueue(
    db: Db,
    type: string,
    payload: Record<string, unknown> = {},
    opts: { runAfter?: Date; dedupeKey?: string; maxAttempts?: number } = {},
  ): Promise<string | null> {
    return db.asService((q) =>
      one<string | null>(q, "app_private.jobs_enqueue($1, $2::jsonb, $3::timestamptz, $4, $5)", [
        type,
        JSON.stringify(payload),
        opts.runAfter?.toISOString() ?? null,
        opts.dedupeKey ?? null,
        opts.maxAttempts ?? 5,
      ]),
    );
  },

  enqueueRecurring(db: Db, type: string, everySeconds: number, now: Date, payload: Record<string, unknown> = {}): Promise<string | null> {
    return db.asService((q) =>
      one<string | null>(q, "app_private.jobs_enqueue_recurring($1, $2, $3::jsonb, $4::timestamptz)", [
        type,
        everySeconds,
        JSON.stringify(payload),
        now.toISOString(),
      ]),
    );
  },

  claim(db: Db, worker: string, limit: number, leaseSeconds: number, now: Date): Promise<JobRow[]> {
    return db.asService((q) =>
      q.query<JobRow>("select * from app_private.jobs_claim($1, $2, $3, $4::timestamptz)", [
        worker,
        limit,
        leaseSeconds,
        now.toISOString(),
      ]),
    );
  },

  complete(db: Db, id: string, worker: string, now: Date): Promise<boolean> {
    return db.asService((q) => one<boolean>(q, "app_private.jobs_complete($1::uuid, $2, $3::timestamptz)", [id, worker, now.toISOString()]));
  },

  fail(db: Db, id: string, worker: string, error: string, retryAfterSeconds: number, retryable: boolean, now: Date): Promise<string> {
    return db.asService((q) =>
      one<string>(q, "app_private.jobs_fail($1::uuid, $2, $3, $4, $5, $6::timestamptz)", [
        id,
        worker,
        error,
        retryAfterSeconds,
        retryable,
        now.toISOString(),
      ]),
    );
  },

  housekeeping(db: Db, now: Date): Promise<Record<string, number>> {
    return db.asService((q) => one<Record<string, number>>(q, "app_private.housekeeping($1::timestamptz)", [now.toISOString()]));
  },
};
