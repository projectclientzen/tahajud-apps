import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PgliteDb } from "@/server/db/pglite";
import { silentLogger } from "@/server/jobs/log";
import { scheduleAll, scheduleUser, type SchedulerDeps } from "@/server/notifications/scheduler";
import { DEMO_BEDTIME_BANK } from "@/server/notifications/copy";
import { addPrayerTimes, addUser, createJobsDb, jobsByType, resetJobsTables, setPrefs } from "./jobs-harness";

let db: PgliteDb;
beforeAll(async () => {
  db = await createJobsDb();
});
afterAll(async () => {
  await db.close();
});

// Thursday 12 Nov 2026, 10:00 WIB (03:00Z).
const NOW = new Date("2026-11-12T03:00:00Z");
beforeEach(async () => {
  await resetJobsTables(db);
  await db.setNow(NOW.toISOString());
  await addPrayerTimes(db, "2026-11-10", "2026-11-20");
});

const deps = (over: Partial<SchedulerDeps> & { now?: () => Date } = {}): SchedulerDeps => ({
  db,
  now: () => NOW,
  log: silentLogger,
  allowDemoBank: true,
  ...over,
});

interface JobRowOut {
  notification_type: string;
  local_schedule_date: string;
  scheduled_at: string;
  expires_at: string;
  status: string;
  template_key: string | null;
  skip_reason: string | null;
}
const jobs = async (userId: string): Promise<JobRowOut[]> =>
  (await db.exec(
    `select notification_type, local_schedule_date::text as local_schedule_date, scheduled_at::text as scheduled_at,
            expires_at::text as expires_at, status, template_key, skip_reason
     from public.notification_jobs where user_id = $1 order by scheduled_at, notification_type`,
    [userId],
  )) as unknown as JobRowOut[];
const timeOf = (rows: JobRowOut[], type: string, date: string) =>
  new Date(rows.find((r) => r.notification_type === type && r.local_schedule_date === date)!.scheduled_at).toISOString();

describe("scheduler: what gets created", () => {
  it("creates tahajud, fajr, bedtime and al-kahfi jobs for the next 36 hours from preferences and the cached schedule", async () => {
    const u = await addUser(db);
    const r = await scheduleUser(deps(), u.id);
    expect(r.created).toBe(5);
    const rows = await jobs(u.id);
    expect(rows.map((x) => `${x.notification_type}:${x.local_schedule_date}`)).toEqual([
      "alkahfi:2026-11-13",
      "bedtime:2026-11-13",
      "tahajud:2026-11-13",
      "fajr:2026-11-13",
      "bedtime:2026-11-14",
    ]);
    expect(rows.every((x) => x.status === "pending")).toBe(true);
    expect(timeOf(rows, "tahajud", "2026-11-13")).toBe("2026-11-12T19:56:00.000Z");
    expect(timeOf(rows, "fajr", "2026-11-13")).toBe("2026-11-12T21:06:00.000Z");
  });

  it("is idempotent: running again creates nothing and changes nothing", async () => {
    const u = await addUser(db);
    await scheduleUser(deps(), u.id);
    const before = await jobs(u.id);
    const again = await scheduleUser(deps(), u.id);
    expect(again).toMatchObject({ created: 0, updated: 0, cancelled: 0, unchanged: 5 });
    expect(await jobs(u.id)).toEqual(before);
  });

  it("dedupe_key = user:type:local_date is unique even when two schedulers run at the same moment", async () => {
    const u = await addUser(db);
    await Promise.all([scheduleUser(deps(), u.id), scheduleUser(deps(), u.id), scheduleUser(deps(), u.id)]);
    const rows = await db.exec("select dedupe_key, count(*)::int as n from public.notification_jobs where user_id = $1 group by 1", [u.id]);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.n === 1)).toBe(true);
    expect(String(rows[0]!.dedupe_key)).toMatch(new RegExp(`^${u.id}:(bedtime|tahajud|fajr|alkahfi):\\d{4}-\\d{2}-\\d{2}$`));
  });

  it("creates nothing for users without an active subscription, without access, or without a location", async () => {
    const noSub = await addUser(db, { subscribed: false });
    const noAccess = await addUser(db, { entitlement: "suspended" });
    const noLocation = await addUser(db, { region: null });
    expect(await scheduleUser(deps(), noSub.id)).toMatchObject({ created: 0, idle: "no_subscription" });
    expect(await scheduleUser(deps(), noAccess.id)).toMatchObject({ created: 0, idle: "no_access" });
    expect(await scheduleUser(deps(), noLocation.id)).toMatchObject({ created: 0, idle: "no_location" });
    expect((await db.exec("select count(*)::int as n from public.notification_jobs"))[0]!.n).toBe(0);
  });

  it("does not invent a schedule: no cached prayer times means no fajr, tahajud or bedtime jobs", async () => {
    await db.exec("delete from public.prayer_times");
    const u = await addUser(db);
    const r = await scheduleUser(deps(), u.id);
    expect((await jobs(u.id)).map((x) => x.notification_type)).toEqual(["alkahfi"]); // needs only the fallback clock
    expect(r.datesWithoutSchedule).toBeGreaterThan(0);
  });

  it("uses a manual schedule and its timezone", async () => {
    const u = await addUser(db, { region: null, manual: { fajr: "04:30", timezone: "Asia/Makassar" } });
    await scheduleUser(deps(), u.id);
    expect(timeOf(await jobs(u.id), "fajr", "2026-11-13")).toBe("2026-11-12T20:30:00.000Z"); // 04:30 WITA
  });
});

describe("NOTIF-01: bedtime rotation", () => {
  it("two nights in a row get different messages", async () => {
    const u = await addUser(db);
    await scheduleUser(deps(), u.id);
    const b = (await jobs(u.id)).filter((x) => x.notification_type === "bedtime");
    expect(b).toHaveLength(2);
    expect(b[0]!.template_key).not.toBe(b[1]!.template_key);
    expect(DEMO_BEDTIME_BANK.map((t) => t.key)).toContain(b[0]!.template_key);
  });

  it("keeps the message it already picked when it plans again", async () => {
    const u = await addUser(db);
    await scheduleUser(deps(), u.id);
    const first = (await jobs(u.id)).filter((x) => x.notification_type === "bedtime").map((x) => x.template_key);
    await scheduleUser(deps(), u.id);
    await setPrefs(db, u.id, { bedtime_offset_minutes: 45 });
    await scheduleUser(deps(), u.id);
    expect((await jobs(u.id)).filter((x) => x.notification_type === "bedtime").map((x) => x.template_key)).toEqual(first);
  });

  it("avoids what was sent on earlier nights", async () => {
    const u = await addUser(db);
    await db.exec(
      `insert into public.notification_jobs (user_id, notification_type, scheduled_at, expires_at, local_schedule_date, template_key, status, dedupe_key)
       values ($1, 'bedtime', '2026-11-11T14:30:00Z', '2026-11-11T15:00:00Z', '2026-11-12', 'demo:1', 'sent', $2)`,
      [u.id, `${u.id}:bedtime:2026-11-12`],
    );
    await scheduleUser(deps(), u.id);
    const keys = (await jobs(u.id)).filter((x) => x.notification_type === "bedtime" && x.status === "pending").map((x) => x.template_key);
    expect(keys).not.toContain("demo:1");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses published templates from the database and ignores drafts and unknown variables", async () => {
    await db.exec(
      `insert into public.notification_templates (category, title, body, is_active, review_status) values
         ('motivasi', 'Judul A', 'Halo {nama}, level {level}', true, 'published'),
         ('refleksi_malam', 'Judul B', 'Refleksi malam untuk {nama}', true, 'published'),
         ('motivasi', 'Draft', 'belum disetujui', true, 'draft'),
         ('motivasi', 'Mati', 'tidak aktif', false, 'published'),
         ('motivasi', 'Variabel liar', 'Halo {email}', true, 'published')`,
    );
    const u = await addUser(db);
    await scheduleUser(deps({ allowDemoBank: false }), u.id);
    const keys = (await jobs(u.id)).filter((x) => x.notification_type === "bedtime").map((x) => x.template_key);
    expect(keys).toHaveLength(2);
    const published = (await db.exec("select id from public.notification_templates where title in ('Judul A', 'Judul B')")).map((r) => r.id);
    expect(keys.every((k) => published.includes(k))).toBe(true);
    expect(new Set(keys).size).toBe(2);
    expect((await db.exec("select template_id from public.notification_jobs where user_id = $1 and notification_type = 'bedtime'", [u.id])).every((r) => r.template_id !== null)).toBe(true);
  });
});

describe("DEMO bedtime bank is never used in production", () => {
  it("an empty bank with demo not allowed creates no bedtime jobs and says why", async () => {
    const u = await addUser(db);
    const r = await scheduleUser(deps({ allowDemoBank: false }), u.id);
    const types = (await jobs(u.id)).map((x) => x.notification_type);
    expect(types).not.toContain("bedtime");
    expect(types).toEqual(expect.arrayContaining(["tahajud", "fajr", "alkahfi"]));
    expect(r.bedtimeSkippedNoBank).toBe(2);
  });

  it("pending bedtime jobs are cancelled when the bank goes away", async () => {
    const u = await addUser(db);
    await scheduleUser(deps({ allowDemoBank: true }), u.id);
    const r = await scheduleUser(deps({ allowDemoBank: false }), u.id);
    expect(r.cancelled).toBe(2);
    expect((await jobs(u.id)).filter((x) => x.notification_type === "bedtime").every((x) => x.status === "skipped" && x.skip_reason === "cancelled")).toBe(true);
  });
});

describe("NOTIF-02: bedtime off", () => {
  it("no bedtime job exists when bedtime is off", async () => {
    const u = await addUser(db);
    await setPrefs(db, u.id, { bedtime_enabled: false });
    await scheduleUser(deps(), u.id);
    expect((await jobs(u.id)).some((x) => x.notification_type === "bedtime")).toBe(false);
  });

  it("turning it off later cancels the pending ones, turning it on revives them", async () => {
    const u = await addUser(db);
    await scheduleUser(deps(), u.id);
    await setPrefs(db, u.id, { bedtime_enabled: false });
    expect(await scheduleUser(deps(), u.id)).toMatchObject({ cancelled: 2 });
    await setPrefs(db, u.id, { bedtime_enabled: true });
    expect(await scheduleUser(deps(), u.id)).toMatchObject({ updated: 2, created: 0 });
    expect((await jobs(u.id)).filter((x) => x.notification_type === "bedtime").every((x) => x.status === "pending")).toBe(true);
  });
});

describe("reschedule on change (PRD §15.4)", () => {
  it("moves pending jobs when the bedtime changes", async () => {
    const u = await addUser(db);
    await scheduleUser(deps(), u.id);
    await setPrefs(db, u.id, { bedtime_local_time: "21:00", bedtime_offset_minutes: 15 });
    const r = await scheduleUser(deps(), u.id);
    expect(r.updated).toBe(2); // both nights inside the horizon move, nothing is duplicated
    const rows = await jobs(u.id);
    expect(rows.filter((x) => x.notification_type === "bedtime")).toHaveLength(2);
    expect(timeOf(rows, "bedtime", "2026-11-13")).toBe("2026-11-12T13:45:00.000Z"); // 20:45 WIB
    expect(timeOf(rows, "bedtime", "2026-11-14")).toBe("2026-11-13T13:45:00.000Z");
  });

  it("moves tahajud when the level goes up", async () => {
    const u = await addUser(db);
    await scheduleUser(deps(), u.id);
    await db.exec("insert into public.user_level_state (user_id, current_level, level_1_unlocked_at) values ($1, 2, now()) on conflict (user_id) do update set current_level = 2", [u.id]);
    await scheduleUser(deps(), u.id);
    expect(timeOf(await jobs(u.id), "tahajud", "2026-11-13")).toBe("2026-11-12T18:56:00.000Z"); // 120 + 10 minutes before fajr
  });

  it("moves everything when the region changes to another timezone", async () => {
    await addPrayerTimes(db, "2026-11-10", "2026-11-20", "DEMO-MKS", "04:17", "18:00");
    const u = await addUser(db);
    await scheduleUser(deps(), u.id);
    await db.exec("update public.profiles set region_id = (select id from public.regions where provider_region_code = 'DEMO-MKS') where user_id = $1", [u.id]);
    await scheduleUser(deps(), u.id);
    expect(timeOf(await jobs(u.id), "fajr", "2026-11-13")).toBe("2026-11-12T20:17:00.000Z"); // 04:17 WITA
  });

  it("never rewrites jobs that were already sent", async () => {
    const u = await addUser(db);
    await scheduleUser(deps(), u.id);
    await db.exec("update public.notification_jobs set status = 'sent', sent_at = now() where user_id = $1 and notification_type = 'fajr'", [u.id]);
    await setPrefs(db, u.id, { fajr_enabled: false });
    await scheduleUser(deps(), u.id);
    expect((await jobs(u.id)).find((x) => x.notification_type === "fajr")!.status).toBe("sent");
  });

  it("database triggers ask for a reschedule when region, bedtime, level, preferences or subscriptions change, and coalesce repeats", async () => {
    const u = await addUser(db);
    await db.exec("delete from public.jobs"); // the inserts above already asked once
    await setPrefs(db, u.id, { bedtime_local_time: "21:30" });
    await setPrefs(db, u.id, { bedtime_local_time: "21:45" });
    let queued = await jobsByType(db, "notification_reschedule");
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toEqual({ user_id: u.id });
    expect(queued[0]!.status).toBe("queued");

    await db.exec("delete from public.jobs");
    await db.exec("update public.profiles set display_name = 'Nama Baru' where user_id = $1", [u.id]);
    expect(await jobsByType(db, "notification_reschedule")).toHaveLength(0); // a name change does not matter

    await db.exec("update public.profiles set region_id = (select id from public.regions where provider_region_code = 'DEMO-MKS') where user_id = $1", [u.id]);
    expect(await jobsByType(db, "notification_reschedule")).toHaveLength(1);

    await db.exec("delete from public.jobs");
    await db.exec("insert into public.user_level_state (user_id, current_level, level_1_unlocked_at) values ($1, 1, now()) on conflict (user_id) do nothing", [u.id]);
    await db.exec("update public.user_level_state set current_level = 2 where user_id = $1", [u.id]);
    expect(await jobsByType(db, "notification_reschedule")).toHaveLength(1);

    await db.exec("delete from public.jobs");
    await db.exec("update public.push_subscriptions set is_active = false where user_id = $1", [u.id]);
    queued = await jobsByType(db, "notification_reschedule");
    expect(queued).toHaveLength(1);
  });

  it("stops planning for a user who unsubscribed and cancels what was waiting", async () => {
    const u = await addUser(db);
    await scheduleUser(deps(), u.id);
    await db.exec("update public.push_subscriptions set is_active = false where user_id = $1", [u.id]);
    const r = await scheduleUser(deps(), u.id);
    expect(r).toMatchObject({ idle: "no_subscription", cancelled: 5 });
  });
});

describe("scheduleAll", () => {
  it("plans every user with a subscription, one failing user does not stop the others", async () => {
    const a = await addUser(db);
    const b = await addUser(db);
    const c = await addUser(db, { region: null, manual: { fajr: "04:30", timezone: "Not/AZone" } }); // bad data
    const r = await scheduleAll(deps(), { pageSize: 2 });
    expect(r.users + r.errors).toBe(3);
    expect(r.errors).toBe(1);
    expect((await jobs(a.id)).length).toBe(5);
    expect((await jobs(b.id)).length).toBe(5);
    expect((await jobs(c.id)).length).toBe(0);
  });

  it("stops at the deadline and says where to continue", async () => {
    await addUser(db);
    await addUser(db);
    await addUser(db);
    const first = await scheduleAll(deps(), { deadlineMs: Date.now() - 1 });
    expect(first.users).toBe(0);
    const all = await scheduleAll(deps(), { after: first.next });
    expect(all.users).toBe(3);
  });
});
