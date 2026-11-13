import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PgliteDb } from "@/server/db/pglite";
import { backoffSeconds } from "@/server/jobs/backoff";
import { queue } from "@/server/jobs/queue";
import { runJobs } from "@/server/jobs/runner";
import { silentLogger } from "@/server/jobs/log";
import { JobError, type JobContext, type JobHandlers } from "@/server/jobs/types";
import { createJobsDb, jobsByType, resetJobsTables } from "./jobs-harness";

let db: PgliteDb;
beforeAll(async () => {
  db = await createJobsDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetJobsTables(db);
});

const T0 = new Date("2026-11-14T00:00:00Z");
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
const ctx = (worker: string, now: Date): JobContext => ({ db, now: () => now, log: silentLogger, workerId: worker });
const row = async (id: string) => (await db.exec("select * from public.jobs where id = $1", [id]))[0]!;

describe("backoffSeconds (PRD §17.7: exponential)", () => {
  it("doubles from 30 seconds and stops at one hour", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => backoffSeconds(n))).toEqual([30, 60, 120, 240, 480, 960, 1920, 3600, 3600, 3600]);
  });
  it("treats 0 or less as the first attempt", () => {
    expect(backoffSeconds(0)).toBe(30);
    expect(backoffSeconds(-3)).toBe(30);
  });
});

describe("job claim (SKIP LOCKED)", () => {
  it("the claim query uses FOR UPDATE SKIP LOCKED (PRD §17.7)", async () => {
    const [{ def }] = (await db.exec("select pg_get_functiondef('app_private.jobs_claim(text,int,int,timestamptz)'::regprocedure) as def")) as { def: string }[];
    expect(def.toLowerCase()).toMatch(/for update skip locked/);
    const [{ def: notif }] = (await db.exec("select pg_get_functiondef('app_private.notif_claim_due(text,int,int,timestamptz)'::regprocedure) as def")) as { def: string }[];
    expect(notif.toLowerCase()).toMatch(/for update skip locked/);
  });

  it("takes due jobs oldest first and leaves future jobs alone", async () => {
    const later = await queue.enqueue(db, "x", { n: 2 }, { runAfter: at(10) });
    const first = await queue.enqueue(db, "x", { n: 1 }, { runAfter: at(-60) });
    const future = await queue.enqueue(db, "x", { n: 3 }, { runAfter: at(3600) });
    const got = await queue.claim(db, "w1", 10, 300, at(20));
    expect(got.map((j) => j.id)).toEqual([first, later]);
    expect(got.every((j) => j.status === "running" && j.locked_by === "w1" && j.attempt_count === 1)).toBe(true);
    expect((await row(future!)).status).toBe("queued");
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 5; i++) await queue.enqueue(db, "x", {}, { runAfter: at(-1) });
    expect(await queue.claim(db, "w1", 2, 300, at(0))).toHaveLength(2);
    expect(await queue.claim(db, "w1", 10, 300, at(0))).toHaveLength(3);
  });

  it("two workers claiming at once never share a job", async () => {
    for (let i = 0; i < 20; i++) await queue.enqueue(db, "x", { i }, { runAfter: at(-1) });
    const [a, b] = await Promise.all([queue.claim(db, "w1", 12, 300, at(0)), queue.claim(db, "w2", 12, 300, at(0))]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(20);
    expect(a.every((j) => j.locked_by === "w1") && b.every((j) => j.locked_by === "w2")).toBe(true);
  });
});

describe("worker idempotency with two instances", () => {
  it("every job runs exactly once when two runners share the queue", async () => {
    for (let i = 0; i < 24; i++) await queue.enqueue(db, "count", { i }, { runAfter: at(-1) });
    const seen: number[] = [];
    const handlers: JobHandlers = {
      count: async (job) => {
        await new Promise((r) => setTimeout(r, 1));
        seen.push(job.payload.i as number);
      },
    };
    const [a, b] = await Promise.all([
      runJobs(ctx("w1", at(0)), handlers, { batch: 3 }),
      runJobs(ctx("w2", at(0)), handlers, { batch: 4 }),
    ]);
    expect(seen.sort((x, y) => x - y)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(a.done + b.done).toBe(24);
    expect((await db.exec("select count(*)::int as n from public.jobs where status = 'done'"))[0]!.n).toBe(24);
  });

  it("completing a job that belongs to another worker changes nothing", async () => {
    const id = (await queue.enqueue(db, "x", {}, { runAfter: at(-1) }))!;
    await queue.claim(db, "w1", 1, 300, at(0));
    expect(await queue.complete(db, id, "w2", at(1))).toBe(false);
    expect((await row(id)).status).toBe("running");
    expect(await queue.complete(db, id, "w1", at(1))).toBe(true);
  });
});

describe("retry, backoff, dead letter", () => {
  it("a failing job goes back to queued with exponential backoff, then dead after max attempts", async () => {
    const id = (await queue.enqueue(db, "boom", {}, { runAfter: at(-1), maxAttempts: 3 }))!;
    const handlers: JobHandlers = { boom: async () => Promise.reject(new Error("upstream 503")) };
    let now = at(0);

    let s = await runJobs(ctx("w1", now), handlers);
    expect(s.retried).toBe(1);
    let r = await row(id);
    expect([r.status, r.attempt_count, r.last_error]).toEqual(["queued", 1, "upstream 503"]);
    expect(new Date(r.run_after as string).getTime()).toBe(now.getTime() + 30_000);

    // Not due yet: nothing runs.
    s = await runJobs(ctx("w1", at(10)), handlers);
    expect(s.claimed).toBe(0);

    now = at(31);
    s = await runJobs(ctx("w1", now), handlers);
    r = await row(id);
    expect([r.status, r.attempt_count]).toEqual(["queued", 2]);
    expect(new Date(r.run_after as string).getTime()).toBe(now.getTime() + 60_000);

    now = at(100);
    s = await runJobs(ctx("w1", now), handlers);
    expect(s.dead).toBe(1);
    r = await row(id);
    expect([r.status, r.attempt_count, r.last_error]).toEqual(["dead", 3, "upstream 503"]);
    expect(r.finished_at).not.toBeNull();

    // Dead jobs are never picked up again.
    expect((await runJobs(ctx("w1", at(100000)), handlers)).claimed).toBe(0);
  });

  it("a non-retryable error is failed at once, without using the remaining attempts", async () => {
    const id = (await queue.enqueue(db, "cfg", {}, { runAfter: at(-1) }))!;
    const s = await runJobs(ctx("w1", at(0)), { cfg: async () => Promise.reject(new JobError("PUSH_NOT_CONFIGURED", false)) });
    expect(s.failed).toBe(1);
    const r = await row(id);
    expect([r.status, r.attempt_count, r.last_error]).toEqual(["failed", 1, "PUSH_NOT_CONFIGURED"]);
  });

  it("an unknown job type is failed with a clear message", async () => {
    const id = (await queue.enqueue(db, "mystery", {}, { runAfter: at(-1) }))!;
    await runJobs(ctx("w1", at(0)), {});
    const r = await row(id);
    expect(r.status).toBe("failed");
    expect(r.last_error).toMatch(/No handler for job type "mystery"/);
  });

  it("a success clears an earlier error", async () => {
    const id = (await queue.enqueue(db, "flaky", {}, { runAfter: at(-1) }))!;
    let n = 0;
    const handlers: JobHandlers = {
      flaky: async () => {
        if (++n === 1) throw new Error("once");
      },
    };
    await runJobs(ctx("w1", at(0)), handlers);
    expect((await row(id)).last_error).toBe("once");
    await runJobs(ctx("w1", at(40)), handlers);
    const r = await row(id);
    expect([r.status, r.last_error]).toEqual(["done", null]);
  });
});

describe("lost workers", () => {
  it("a running job whose lease ran out is taken by another worker", async () => {
    const id = (await queue.enqueue(db, "x", {}, { runAfter: at(-1) }))!;
    await queue.claim(db, "w1", 1, 300, at(0)); // w1 dies here
    expect(await queue.claim(db, "w2", 1, 300, at(100))).toHaveLength(0); // lease still valid
    const got = await queue.claim(db, "w2", 1, 300, at(400));
    expect(got.map((j) => [j.id, j.locked_by, j.attempt_count])).toEqual([[id, "w2", 2]]);
    // The first worker's late answer is ignored.
    expect(await queue.complete(db, id, "w1", at(401))).toBe(false);
    expect(await queue.fail(db, id, "w1", "late", 30, true, at(401))).toBe("ignored");
  });

  it("a lost job with no attempts left is dead, not run again", async () => {
    const id = (await queue.enqueue(db, "x", {}, { runAfter: at(-1), maxAttempts: 1 }))!;
    await queue.claim(db, "w1", 1, 300, at(0));
    expect(await queue.claim(db, "w2", 1, 300, at(400))).toHaveLength(0);
    const r = await row(id);
    expect(r.status).toBe("dead");
    expect(String(r.last_error)).toMatch(/lease expired/);
  });
});

describe("enqueue", () => {
  it("coalesces a repeated request while one is still waiting (dedupe key)", async () => {
    const a = await queue.enqueue(db, "notification_reschedule", { u: 1 }, { dedupeKey: "k1" });
    const b = await queue.enqueue(db, "notification_reschedule", { u: 1 }, { dedupeKey: "k1" });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    // Once it has run, the same key can be queued again: a change after the run needs a new run.
    await queue.claim(db, "w", 1, 300, new Date(Date.now() + 1000));
    expect(await queue.enqueue(db, "notification_reschedule", { u: 1 }, { dedupeKey: "k1" })).not.toBeNull();
  });

  it("recurring jobs: only one per interval, even when two instances ask at the same moment", async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => queue.enqueueRecurring(db, "prayer_sync", 3600, at(0))));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await jobsByType(db, "prayer_sync")).toHaveLength(1);
  });

  it("recurring jobs: not again while one is queued or running, and not before the interval has passed", async () => {
    expect(await queue.enqueueRecurring(db, "sweep", 60, at(0))).not.toBeNull();
    expect(await queue.enqueueRecurring(db, "sweep", 60, at(120))).toBeNull(); // still queued, however old
    const [j] = await queue.claim(db, "w", 1, 300, at(120));
    expect(await queue.enqueueRecurring(db, "sweep", 60, at(130))).toBeNull(); // running
    await queue.complete(db, j!.id, "w", at(130));
    expect(await queue.enqueueRecurring(db, "sweep", 60, at(150))).not.toBeNull(); // done, and created 150 s ago
    const [k] = await queue.claim(db, "w", 1, 300, at(150));
    await queue.complete(db, k!.id, "w", at(151));
    expect(await queue.enqueueRecurring(db, "sweep", 60, at(180))).toBeNull(); // created 30 s ago: too soon
    expect(await queue.enqueueRecurring(db, "sweep", 60, at(211))).not.toBeNull();
  });
});
