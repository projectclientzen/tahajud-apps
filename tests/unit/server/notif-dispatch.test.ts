import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PgliteDb } from "@/server/db/pglite";
import { silentLogger } from "@/server/jobs/log";
import { dispatchDue, PushNotConfiguredError, type DispatchDeps } from "@/server/notifications/dispatcher";
import { addUser, createJobsDb, FakeSender, resetJobsTables, setPrefs, type TestUser } from "./jobs-harness";

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

const wib = (hhmm: string, date = "2026-11-13") => new Date(`${date}T${hhmm}:00+07:00`);
const EXPIRY = { bedtime: 30, tahajud: 15, fajr: 20, alkahfi: 360 } as const;

async function addJob(
  u: TestUser,
  type: keyof typeof EXPIRY,
  at: Date,
  over: { templateKey?: string | null; templateId?: string | null } = {},
): Promise<string> {
  const expires = new Date(at.getTime() + EXPIRY[type] * 60_000);
  const rows = await db.exec(
    `insert into public.notification_jobs (user_id, notification_type, scheduled_at, expires_at, local_schedule_date, template_key, template_id, status, dedupe_key)
     values ($1, $2, $3, $4, '2026-11-13', $5, $6, 'pending', $7) returning id`,
    [u.id, type, at.toISOString(), expires.toISOString(), over.templateKey ?? null, over.templateId ?? null, `${u.id}:${type}:${at.toISOString()}`],
  );
  return rows[0]!.id as string;
}

const job = async (id: string) =>
  (await db.exec("select status, skip_reason, attempt_count, sent_at, last_error, locked_until from public.notification_jobs where id = $1", [id]))[0]!;

function deps(now: Date, sender: FakeSender | null, over: Partial<DispatchDeps> = {}): DispatchDeps {
  return { db, now: () => now, log: silentLogger, sender, workerId: "d1", allowDemoBank: true, ...over };
}

describe("dispatch: sending", () => {
  it("sends a due job, records the delivery, and uses the notification type's expiry as the push TTL", async () => {
    const u = await addUser(db);
    const id = await addJob(u, "tahajud", wib("03:00"));
    const sender = new FakeSender();
    const r = await dispatchDue(deps(wib("03:00"), sender));
    expect(r).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]!.payload).toMatchObject({ type: "tahajud", url: "/worship/session" });
    expect(sender.calls[0]!.payload.title).toBe("Waktunya bangun");
    expect(sender.calls[0]!.ttlSeconds).toBe(900);
    expect((await job(id)).status).toBe("sent");
    const d = await db.exec("select delivery_status, provider_status_code, subscription_id from public.notification_deliveries where job_id = $1", [id]);
    expect(d).toEqual([{ delivery_status: "sent", provider_status_code: 201, subscription_id: u.subscriptionId }]);
    expect((await db.exec("select last_success_at, failure_count from public.push_subscriptions where id = $1", [u.subscriptionId]))[0]!.failure_count).toBe(0);
  });

  it("shortens the TTL when the worker is late, never beyond the expiry", async () => {
    const u = await addUser(db);
    await addJob(u, "fajr", wib("04:06"));
    const sender = new FakeSender();
    await dispatchDue(deps(wib("04:16"), sender)); // 10 of 20 minutes used
    expect(sender.calls[0]!.ttlSeconds).toBe(600);
  });

  it("does not send before the scheduled time", async () => {
    const u = await addUser(db);
    const id = await addJob(u, "fajr", wib("04:06"));
    const sender = new FakeSender();
    expect(await dispatchDue(deps(wib("04:05"), sender))).toMatchObject({ claimed: 0 });
    expect(sender.calls).toHaveLength(0);
    expect((await job(id)).status).toBe("pending");
  });

  it("sends to every device of the user", async () => {
    const u = await addUser(db);
    await db.exec("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example.test/second', 'k', 'a')", [u.id]);
    await addJob(u, "fajr", wib("04:06"));
    const sender = new FakeSender();
    await dispatchDue(deps(wib("04:07"), sender));
    expect(sender.calls.map((c) => c.sub.endpoint).sort()).toEqual([`https://push.example.test/${u.id}`, "https://push.example.test/second"]);
  });

  it("skips subscriptions of a revoked device", async () => {
    const u = await addUser(db);
    const dev = (await db.exec("insert into public.user_devices (user_id, label, revoked_at) values ($1, 'HP lama', now()) returning id", [u.id]))[0]!.id;
    await db.exec("update public.push_subscriptions set device_id = $2 where user_id = $1", [u.id, dev]);
    const id = await addJob(u, "fajr", wib("04:06"));
    const sender = new FakeSender();
    await dispatchDue(deps(wib("04:07"), sender));
    expect(sender.calls).toHaveLength(0);
    expect(await job(id)).toMatchObject({ status: "skipped", skip_reason: "no_subscription" });
  });

  it("fills {nama} with the first name and {level}, from a demo template", async () => {
    const u = await addUser(db, { displayName: "Zen Pratama", level: 2 });
    await addJob(u, "bedtime", wib("21:30", "2026-11-12"), { templateKey: "demo:3" });
    const sender = new FakeSender();
    await dispatchDue(deps(wib("21:31", "2026-11-12"), sender));
    expect(sender.calls[0]!.payload.title).toMatch(/^\[DEMO\]/);
    expect(sender.calls[0]!.payload.body).toContain("Zen");
    expect(sender.calls[0]!.payload.body).not.toContain("Pratama");
  });

  it("uses a published database template and never a draft", async () => {
    const t = await db.exec(
      `insert into public.notification_templates (category, title, body, review_status) values ('motivasi', 'Malam tenang', 'Halo {nama}, level {level}', 'published'),
                                                                                           ('motivasi', 'Draft', 'x', 'draft') returning id, title`,
    );
    const published = t.find((r) => r.title === "Malam tenang")!.id as string;
    const draft = t.find((r) => r.title === "Draft")!.id as string;
    const u = await addUser(db, { displayName: "Sari", level: 3 });
    const ok = await addJob(u, "bedtime", wib("21:30", "2026-11-12"), { templateKey: published, templateId: published });
    const sender = new FakeSender();
    await dispatchDue(deps(wib("21:31", "2026-11-12"), sender, { allowDemoBank: false }));
    expect(sender.calls[0]!.payload).toMatchObject({ title: "Malam tenang", body: "Halo Sari, level 3" });
    expect((await job(ok)).status).toBe("sent");

    await resetJobsTables(db);
    const u2 = await addUser(db);
    const bad = await addJob(u2, "bedtime", wib("21:30", "2026-11-12"), { templateKey: draft, templateId: null });
    const sender2 = new FakeSender();
    await dispatchDue(deps(wib("21:31", "2026-11-12"), sender2, { allowDemoBank: false }));
    expect(sender2.calls).toHaveLength(0);
    expect(await job(bad)).toMatchObject({ status: "skipped", skip_reason: "template_unavailable" });
  });
});

describe("NOTIF-04: expiry", () => {
  it("a tahajud job planned for 03:00 and picked up at 03:20 is expired and not sent", async () => {
    const u = await addUser(db);
    const id = await addJob(u, "tahajud", wib("03:00"));
    const sender = new FakeSender();
    const r = await dispatchDue(deps(wib("03:20"), sender));
    expect(sender.calls).toHaveLength(0);
    expect(r).toMatchObject({ expired: 1, claimed: 0, sent: 0 });
    expect(await job(id)).toMatchObject({ status: "expired", skip_reason: "expired" });
  });

  it("is still sent at 03:14 and expired at 03:16", async () => {
    const u = await addUser(db);
    const late = await addJob(u, "tahajud", wib("03:00"));
    const s1 = new FakeSender();
    await dispatchDue(deps(wib("03:14"), s1));
    expect(s1.calls).toHaveLength(1);
    expect((await job(late)).status).toBe("sent");

    const u2 = await addUser(db);
    const stale = await addJob(u2, "tahajud", wib("03:00", "2026-11-14"));
    const s2 = new FakeSender();
    await dispatchDue(deps(wib("03:16", "2026-11-14"), s2));
    expect(s2.calls).toHaveLength(0);
    expect((await job(stale)).status).toBe("expired");
  });

  it("each type has its own window: bedtime 30, fajr 20, al-kahfi 6 hours", async () => {
    const u = await addUser(db);
    const ids = {
      bedtime: await addJob(u, "bedtime", wib("21:00", "2026-11-12"), { templateKey: "demo:1" }),
      fajr: await addJob(u, "fajr", wib("04:00")),
      alkahfi: await addJob(u, "alkahfi", wib("17:51", "2026-11-12")),
    };
    const sender = new FakeSender();
    // At 23:30: bedtime (21:00 + 30 min) is long expired, al-kahfi (17:51 + 6 h) still counts, fajr of the 13th is not due.
    await dispatchDue(deps(wib("23:30", "2026-11-12"), sender));
    expect((await job(ids.bedtime)).status).toBe("expired");
    expect((await job(ids.alkahfi)).status).toBe("sent");
    expect((await job(ids.fajr)).status).toBe("pending"); // not due yet
  });
});

describe("NOTIF-05, NOTIF-02: quiet hours and switches", () => {
  it("quiet hours 22:00 to 04:00 without worship exception: a 22:30 bedtime is not sent", async () => {
    const u = await addUser(db);
    await setPrefs(db, u.id, { quiet_hours_enabled: true, quiet_hours_start: "22:00", quiet_hours_end: "04:00", quiet_hours_allow_worship: false });
    const id = await addJob(u, "bedtime", wib("22:30", "2026-11-12"), { templateKey: "demo:1" });
    const sender = new FakeSender();
    await dispatchDue(deps(wib("22:31", "2026-11-12"), sender));
    expect(sender.calls).toHaveLength(0);
    expect(await job(id)).toMatchObject({ status: "skipped", skip_reason: "quiet_hours" });
  });

  it("without the worship exception tahajud and fajr inside quiet hours are held back too", async () => {
    const u = await addUser(db);
    await setPrefs(db, u.id, { quiet_hours_enabled: true, quiet_hours_start: "22:00", quiet_hours_end: "04:00", quiet_hours_allow_worship: false });
    const t = await addJob(u, "tahajud", wib("03:00"));
    const sender = new FakeSender();
    await dispatchDue(deps(wib("03:01"), sender));
    expect(sender.calls).toHaveLength(0);
    expect(await job(t)).toMatchObject({ status: "skipped", skip_reason: "quiet_hours" });
  });

  it("with the worship exception, tahajud still arrives but bedtime does not", async () => {
    const u = await addUser(db);
    await setPrefs(db, u.id, { quiet_hours_enabled: true, quiet_hours_start: "22:00", quiet_hours_end: "04:00", quiet_hours_allow_worship: true });
    const t = await addJob(u, "tahajud", wib("03:00"));
    const b = await addJob(u, "bedtime", wib("22:30", "2026-11-12"), { templateKey: "demo:1" });
    const sender = new FakeSender();
    await dispatchDue(deps(wib("22:31", "2026-11-12"), sender));
    expect((await job(b)).skip_reason).toBe("quiet_hours");
    await dispatchDue(deps(wib("03:01"), sender));
    expect((await job(t)).status).toBe("sent");
    expect(sender.calls.map((c) => c.payload.type)).toEqual(["tahajud"]);
  });

  it("quiet hours off: nothing is held back", async () => {
    const u = await addUser(db);
    await setPrefs(db, u.id, { quiet_hours_enabled: false, quiet_hours_start: "22:00", quiet_hours_end: "04:00" });
    await addJob(u, "bedtime", wib("22:30", "2026-11-12"), { templateKey: "demo:1" });
    const sender = new FakeSender();
    expect((await dispatchDue(deps(wib("22:31", "2026-11-12"), sender))).sent).toBe(1);
  });

  it("a type switched off after planning is skipped at send time (NOTIF-02)", async () => {
    const u = await addUser(db);
    await setPrefs(db, u.id, { bedtime_enabled: false });
    const id = await addJob(u, "bedtime", wib("21:30", "2026-11-12"), { templateKey: "demo:1" });
    const sender = new FakeSender();
    await dispatchDue(deps(wib("21:31", "2026-11-12"), sender));
    expect(sender.calls).toHaveLength(0);
    expect(await job(id)).toMatchObject({ status: "skipped", skip_reason: "disabled" });
  });

  it("an account that lost access gets nothing", async () => {
    const u = await addUser(db, { entitlement: "suspended" });
    const id = await addJob(u, "fajr", wib("04:06"));
    const sender = new FakeSender();
    await dispatchDue(deps(wib("04:07"), sender));
    expect(sender.calls).toHaveLength(0);
    expect(await job(id)).toMatchObject({ status: "skipped", skip_reason: "no_access" });
  });
});

describe("DEMO bank in production", () => {
  it("a demo template is never sent when demo is not allowed", async () => {
    const u = await addUser(db);
    const id = await addJob(u, "bedtime", wib("21:30", "2026-11-12"), { templateKey: "demo:1" });
    const sender = new FakeSender();
    await dispatchDue(deps(wib("21:31", "2026-11-12"), sender, { allowDemoBank: false }));
    expect(sender.calls).toHaveLength(0);
    expect(await job(id)).toMatchObject({ status: "skipped", skip_reason: "demo_not_allowed" });
  });
});

describe("push outcomes (PRD §15.4)", () => {
  it("404/410 turns the subscription off and the job is skipped as gone", async () => {
    const u = await addUser(db);
    const id = await addJob(u, "fajr", wib("04:06"));
    const sender = new FakeSender(() => ({ status: "deactivate", statusCode: 410, attempts: 1 }));
    const r = await dispatchDue(deps(wib("04:07"), sender));
    expect(r.deactivated).toBe(1);
    expect(await job(id)).toMatchObject({ status: "skipped", skip_reason: "subscriptions_gone" });
    expect((await db.exec("select is_active from public.push_subscriptions where id = $1", [u.subscriptionId]))[0]!.is_active).toBe(false);
    expect((await db.exec("select delivery_status, provider_status_code from public.notification_deliveries where job_id = $1", [id]))[0]).toEqual({
      delivery_status: "deactivate",
      provider_status_code: 410,
    });
  });

  it("one dead device and one live device: the job counts as sent", async () => {
    const u = await addUser(db);
    await db.exec("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example.test/gone', 'k', 'a')", [u.id]);
    const id = await addJob(u, "fajr", wib("04:06"));
    const sender = new FakeSender((sub) =>
      sub.endpoint.endsWith("/gone") ? { status: "deactivate", statusCode: 404, attempts: 1 } : { status: "sent", statusCode: 201, attempts: 1 },
    );
    await dispatchDue(deps(wib("04:07"), sender));
    expect((await job(id)).status).toBe("sent");
    expect((await db.exec("select count(*)::int as n from public.push_subscriptions where user_id = $1 and is_active", [u.id]))[0]!.n).toBe(1);
  });

  it("a push service outage is retried inside the expiry window, counts failures, then gives up", async () => {
    const u = await addUser(db);
    const id = await addJob(u, "fajr", wib("04:06"));
    const sender = new FakeSender(() => ({ status: "failed", statusCode: 503, attempts: 3, error: "503" }));
    let r = await dispatchDue(deps(wib("04:07"), sender));
    expect(r.retried).toBe(1);
    let j = await job(id);
    expect([j.status, j.attempt_count]).toEqual(["pending", 1]);
    expect(new Date(j.locked_until as string).getTime()).toBe(wib("04:07").getTime() + 60_000);

    r = await dispatchDue(deps(wib("04:07"), sender)); // still locked: the retry waits
    expect(r.claimed).toBe(0);

    r = await dispatchDue(deps(wib("04:09"), sender));
    expect(r.retried).toBe(1);
    r = await dispatchDue(deps(wib("04:12"), sender));
    expect(r.failed).toBe(1);
    j = await job(id);
    expect([j.status, j.attempt_count]).toEqual(["failed", 3]);
    expect((await db.exec("select failure_count from public.push_subscriptions where id = $1", [u.subscriptionId]))[0]!.failure_count).toBe(3);
  });

  it("a retry that outlives the expiry is expired, not sent late", async () => {
    const u = await addUser(db);
    const id = await addJob(u, "tahajud", wib("03:00"));
    const down = new FakeSender(() => ({ status: "failed", statusCode: 503, attempts: 3, error: "503" }));
    await dispatchDue(deps(wib("03:10"), down));
    const sender = new FakeSender();
    await dispatchDue(deps(wib("03:20"), sender));
    expect(sender.calls).toHaveLength(0);
    expect((await job(id)).status).toBe("expired");
  });

  it("a 400 from the push service is not retried", async () => {
    const u = await addUser(db);
    const id = await addJob(u, "fajr", wib("04:06"));
    const sender = new FakeSender(() => ({ status: "failed", statusCode: 400, attempts: 1, error: "bad" }));
    expect(await dispatchDue(deps(wib("04:07"), sender))).toMatchObject({ failed: 1, retried: 0 });
    expect((await job(id)).status).toBe("failed");
  });
});

describe("two dispatchers", () => {
  it("each notification is sent once even when two dispatchers run at the same time", async () => {
    const users = await Promise.all(Array.from({ length: 12 }, () => addUser(db)));
    for (const u of users) await addJob(u, "fajr", wib("04:06"));
    const s1 = new FakeSender();
    const s2 = new FakeSender();
    const [a, b] = await Promise.all([
      dispatchDue(deps(wib("04:07"), s1, { workerId: "d1" })),
      dispatchDue(deps(wib("04:07"), s2, { workerId: "d2" })),
    ]);
    const endpoints = [...s1.calls, ...s2.calls].map((c) => c.sub.endpoint);
    expect(new Set(endpoints).size).toBe(12);
    expect(endpoints).toHaveLength(12);
    expect(a.sent + b.sent).toBe(12);
  });
});

describe("push not configured", () => {
  it("fails with a clear message when something is due", async () => {
    const u = await addUser(db);
    await addJob(u, "fajr", wib("04:06"));
    await expect(dispatchDue(deps(wib("04:07"), null, { senderProblem: "Missing env: VAPID_PUBLIC_KEY" }))).rejects.toThrow(
      new PushNotConfiguredError("Missing env: VAPID_PUBLIC_KEY"),
    );
  });

  it("is quiet when nothing is due, and still expires old notifications", async () => {
    const u = await addUser(db);
    const old = await addJob(u, "fajr", wib("04:06"));
    await addJob(u, "fajr", wib("04:06", "2026-11-20")); // far future
    const r = await dispatchDue(deps(wib("05:00"), null));
    expect(r.expired).toBe(1);
    expect((await job(old)).status).toBe("expired");
  });
});
