import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PgliteDb } from "@/server/db/pglite";
import { tick } from "@/server/jobs/tick";
import type { Services } from "@/server/jobs/services";
import { addPrayerTimes, addUser, createJobsDb, FakeSender, jobsByType, makeServices, resetJobsTables, setPrefs } from "./jobs-harness";

let db: PgliteDb;
beforeAll(async () => {
  db = await createJobsDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetJobsTables(db);
  await addPrayerTimes(db, "2026-11-10", "2026-11-20");
});

/** One services object whose clock (and the database clock) can be moved. */
function clock(start: string, over: Partial<Services> = {}) {
  let now = new Date(start);
  const svc = makeServices(db, { now: () => now, config: { cronSecret: null, allowDemoBank: true, prayerProvider: null }, ...over });
  return {
    svc,
    async at(iso: string) {
      now = new Date(iso);
      await db.setNow(iso);
    },
  };
}

const notifs = async (status?: string) =>
  db.exec(`select notification_type, status, skip_reason from public.notification_jobs ${status ? "where status = $1" : ""} order by scheduled_at`, status ? [status] : []);

describe("tick: the whole chain", () => {
  it("plans notifications, then sends them when they are due, and never twice", async () => {
    const u = await addUser(db);
    const sender = new FakeSender();
    const c = clock("2026-11-12T03:00:00Z", { sender }); // Thursday 10:00 WIB
    await c.at("2026-11-12T03:00:00Z");

    // Minute 0: recurring jobs are created, the schedule sweep plans 5 notifications, nothing is due yet.
    const t0 = await tick(c.svc);
    expect(t0.enqueued).toEqual(expect.arrayContaining(["notification_schedule", "housekeeping"]));
    expect((await notifs()).length).toBe(5);
    expect(t0.enqueued).not.toContain("notification_dispatch"); // nothing due: no dispatch job
    expect(sender.calls).toHaveLength(0);

    // Thursday Maghrib 17:51 WIB: the al-kahfi reminder is due.
    await c.at("2026-11-12T10:52:00Z");
    const t1 = await tick(c.svc);
    expect(t1.enqueued).toContain("notification_dispatch");
    expect(sender.calls.map((x) => x.payload.type)).toEqual(["alkahfi"]);

    // A second tick in the same minute sends nothing more.
    await tick(c.svc);
    expect(sender.calls).toHaveLength(1);

    // Bedtime 21:30 WIB, tahajud 02:56, fajr 04:06.
    await c.at("2026-11-12T14:31:00Z");
    await tick(c.svc);
    await c.at("2026-11-12T19:57:00Z");
    await tick(c.svc);
    await c.at("2026-11-12T21:07:00Z");
    await tick(c.svc);
    expect(sender.calls.map((x) => x.payload.type)).toEqual(["alkahfi", "bedtime", "tahajud", "fajr"]);
    expect(sender.calls.every((x) => x.sub.endpoint.endsWith(u.id))).toBe(true);
    expect((await notifs("sent")).length).toBe(4);
  });

  it("a worker that wakes up late sends nothing stale (NOTIF-04 through the whole chain)", async () => {
    await addUser(db);
    const sender = new FakeSender();
    const c = clock("2026-11-12T03:00:00Z", { sender });
    await c.at("2026-11-12T03:00:00Z");
    await tick(c.svc);
    // The server was down from 02:00 to 03:20 WIB on the 13th (19:00Z to 20:20Z on the 12th): tahajud was due 02:56.
    await c.at("2026-11-12T20:20:00Z");
    await tick(c.svc);
    const expired = await notifs("expired");
    expect(expired.map((r) => r.notification_type)).toEqual(expect.arrayContaining(["tahajud", "bedtime"]));
    expect(sender.calls.some((x) => x.payload.type === "tahajud")).toBe(false);
    expect(sender.calls.some((x) => x.payload.type === "bedtime")).toBe(false);
    // Fajr (04:06 WIB = 21:06Z) is still ahead and is sent on time.
    await c.at("2026-11-12T21:07:00Z");
    await tick(c.svc);
    expect(sender.calls.some((x) => x.payload.type === "fajr")).toBe(true);
  });

  it("a preference change reaches the plan through the trigger and the reschedule job, without waiting for the sweep", async () => {
    const u = await addUser(db);
    const c = clock("2026-11-12T03:00:00Z", { sender: new FakeSender() });
    await c.at("2026-11-12T03:00:00Z");
    await tick(c.svc);
    await db.exec("delete from public.jobs where status = 'queued'"); // forget requests made while setting up
    await setPrefs(db, u.id, { tahajud_enabled: false });
    expect(await jobsByType(db, "notification_reschedule")).toHaveLength(1);
    await c.at("2026-11-12T03:01:00Z");
    const t = await tick(c.svc);
    expect(t.run.byType.notification_reschedule).toBe(1);
    const tahajud = (await db.exec("select status, skip_reason from public.notification_jobs where notification_type = 'tahajud'"))[0]!;
    expect(tahajud).toEqual({ status: "skipped", skip_reason: "cancelled" });
  });

  it("recurring jobs follow their own interval: the sweep every 15 minutes, housekeeping once a day", async () => {
    const c = clock("2026-11-12T03:00:00Z");
    await c.at("2026-11-12T03:00:00Z");
    await tick(c.svc);
    await c.at("2026-11-12T03:10:00Z");
    await tick(c.svc);
    expect(await jobsByType(db, "notification_schedule")).toHaveLength(1);
    await c.at("2026-11-12T03:16:00Z");
    await tick(c.svc);
    expect(await jobsByType(db, "notification_schedule")).toHaveLength(2);
    expect(await jobsByType(db, "housekeeping")).toHaveLength(1);
    expect(await jobsByType(db, "prayer_sync")).toHaveLength(1);
  });

  it("without VAPID keys a due notification makes the dispatch job fail with the reason, at most once per 15 minutes", async () => {
    await addUser(db);
    const c = clock("2026-11-12T03:00:00Z", { sender: null, senderProblem: "Missing env: VAPID_PUBLIC_KEY" });
    await c.at("2026-11-12T03:00:00Z");
    await tick(c.svc);
    await c.at("2026-11-12T10:52:00Z"); // al-kahfi is due
    await tick(c.svc);
    await c.at("2026-11-12T10:53:00Z");
    await tick(c.svc);
    const d = await jobsByType(db, "notification_dispatch");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ status: "failed" }); // retrying cannot fix missing keys
    expect(String(d[0]!.last_error)).toBe("Missing env: VAPID_PUBLIC_KEY");
    expect((await notifs("sent")).length).toBe(0);
  });

  it("housekeeping removes finished jobs older than a week and expired auth leftovers, and keeps dead jobs", async () => {
    await db.exec("insert into public.jobs (job_type, status, finished_at) values ('x', 'done', '2026-11-01T00:00:00Z'), ('x', 'done', '2026-11-11T00:00:00Z'), ('x', 'dead', '2026-11-01T00:00:00Z')");
    await db.exec("insert into public.login_otps (email_hash, code_hash, issued_at) values ('h', 'c', '2026-11-01T00:00:00Z')");
    await db.exec("insert into public.rate_limits (key, window_start, count) values ('k', '2026-11-01T00:00:00Z', 1), ('k', '2026-11-12T00:00:00Z', 1)");
    const c = clock("2026-11-12T03:00:00Z");
    await c.at("2026-11-12T03:00:00Z");
    await tick(c.svc);
    const left = await db.exec("select status, finished_at::text from public.jobs where job_type = 'x' order by finished_at");
    expect(left.map((r) => r.status)).toEqual(["dead", "done"]);
    expect((await db.exec("select count(*)::int as n from public.login_otps"))[0]!.n).toBe(0);
    expect((await db.exec("select count(*)::int as n from public.rate_limits"))[0]!.n).toBe(1);
  });
});
