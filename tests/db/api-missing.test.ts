import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataExportSchema } from "@/data/contracts";
import {
  as,
  attempt,
  completeSession,
  createTestDb,
  createUser,
  rows,
  startSession,
  activityId,
  applyOp,
} from "./harness";

const day = (n: number) => `2026-11-${String(n).padStart(2, "0")}`;
const at = (n: number, time = "02:00") => `${day(n)}T${time}:00+07:00`;
const NOW = at(12);

/** app_private.<fn>(uid, now, ...args) as the backend would call it. */
async function q<T = unknown>(
  pg: PGlite,
  uid: string,
  now: string,
  fn: string,
  args: unknown[] = [],
  casts: string[] = [],
) {
  const ph = args.map((_, i) => `$${i + 3}${casts[i] ? "::" + casts[i] : ""}`).join(", ");
  const r = await rows<{ r: T }>(pg, `select app_private.${fn}($1::uuid, $2::timestamptz${ph ? ", " + ph : ""}) as r`, [
    uid,
    now,
    ...args,
  ]);
  return r[0]!.r;
}
const fail = async (
  pg: PGlite,
  uid: string | null,
  now: string,
  fn: string,
  args: unknown[],
  casts: string[],
  code: string,
) => {
  const ph = args.map((_, i) => `$${i + 3}${casts[i] ? "::" + casts[i] : ""}`).join(", ");
  const r = await attempt(pg, `select app_private.${fn}($1::uuid, $2::timestamptz${ph ? ", " + ph : ""})`, [
    uid,
    now,
    ...args,
  ]);
  expect(r, `${fn} should fail with ${code}`).toMatchObject({ ok: false, error: { message: code } });
};

const EP = (n: number | string) => `https://push.example.test/send/${n}`;
const add = (
  pg: PGlite,
  uid: string,
  endpoint: string,
  opts: { device?: string | null; p256dh?: string; auth?: string; now?: string } = {},
) =>
  q<{ id: string; is_active: boolean; created_at: string }>(
    pg,
    uid,
    opts.now ?? NOW,
    "add_push_subscription",
    [opts.device ?? null, endpoint, opts.p256dh ?? "key-p256dh", opts.auth ?? "key-auth"],
    ["uuid", "text", "text", "text"],
  );
const device = async (pg: PGlite, uid: string, label = "Chrome di Android") =>
  (
    await rows<{ id: string }>(pg, "insert into public.user_devices (user_id, label) values ($1, $2) returning id", [
      uid,
      label,
    ])
  )[0]!.id;
const subCount = async (pg: PGlite, uid: string) =>
  Number(
    (await rows<{ n: string }>(pg, "select count(*) as n from public.push_subscriptions where user_id = $1", [uid]))[0]!
      .n,
  );

describe("push subscriptions (PRD §19.7, SEC-14)", () => {
  let pg: PGlite;
  let a: string;
  let b: string;
  beforeAll(async () => {
    pg = await createTestDb();
    a = await createUser(pg);
    b = await createUser(pg);
  });
  afterAll(async () => pg.close());

  it("stores a subscription and answers with id, state and time only: no endpoint, no keys", async () => {
    const r = await add(pg, a, EP("a1"));
    expect(Object.keys(r).sort()).toEqual(["created_at", "id", "is_active"]);
    expect(r.is_active).toBe(true);
    expect(JSON.stringify(r)).not.toContain("push.example.test");
    expect(await subCount(pg, a)).toBe(1);
  });

  it("the same browser subscribing again keeps one row, new keys, and is reactivated", async () => {
    const first = await add(pg, a, EP("a2"), { p256dh: "old-key", auth: "old-auth" });
    await pg.query("update public.push_subscriptions set is_active = false, failure_count = 4 where id = $1", [
      first.id,
    ]);
    const again = await add(pg, a, EP("a2"), { p256dh: "new-key", auth: "new-auth" });
    expect(again.id).toBe(first.id);
    const row = (
      await rows<{ p256dh: string; auth: string; is_active: boolean; failure_count: number }>(
        pg,
        "select p256dh, auth, is_active, failure_count from public.push_subscriptions where id = $1",
        [first.id],
      )
    )[0]!;
    expect(row).toMatchObject({ p256dh: "new-key", auth: "new-auth", is_active: true, failure_count: 0 });
  });

  it("a second person signing in on the same browser takes over the endpoint; the first person's row is replaced", async () => {
    const mine = await add(pg, a, EP("shared"));
    const theirs = await add(pg, b, EP("shared"));
    expect(theirs.id).toBe(mine.id);
    const owner = (
      await rows<{ user_id: string }>(pg, "select user_id from public.push_subscriptions where endpoint = $1", [
        EP("shared"),
      ])
    )[0]!;
    expect(owner.user_id).toBe(b);
    expect((await rows(pg, "select 1 from public.push_subscriptions where endpoint = $1", [EP("shared")])).length).toBe(
      1,
    );
  });

  it.each([
    ["an http endpoint", { endpoint: "http://push.example.test/x" }],
    ["no scheme", { endpoint: "push.example.test/x" }],
    ["an endpoint over 2048 characters", { endpoint: `https://x.test/${"a".repeat(2100)}` }],
    ["an empty key", { p256dh: "" }],
    ["an empty auth secret", { auth: "" }],
    ["a key over 512 characters", { p256dh: "k".repeat(513) }],
  ])("refuses %s", async (_n, o) => {
    const args = { endpoint: EP("bad"), p256dh: "k", auth: "s", ...o };
    await fail(
      pg,
      a,
      NOW,
      "add_push_subscription",
      [null, args.endpoint, args.p256dh, args.auth],
      ["uuid", "text", "text", "text"],
      "VALIDATION_ERROR",
    );
  });

  it("needs an active entitlement to subscribe, in every inactive state", async () => {
    for (const ent of ["suspended", "revoked", "expired", "pending_verification", "none"] as const) {
      const u = await createUser(pg, { entitlement: ent });
      await fail(
        pg,
        u,
        NOW,
        "add_push_subscription",
        [null, EP(`e-${ent}`), "k", "s"],
        ["uuid", "text", "text", "text"],
        "ENTITLEMENT_INACTIVE",
      );
    }
  });

  it("ignores a device id that is not the user's own or is no longer signed in", async () => {
    const mine = await device(pg, a);
    const theirs = await device(pg, b);
    const gone = await device(pg, a, "Lama");
    await pg.query("update public.user_devices set revoked_at = now() where id = $1", [gone]);
    const s1 = await add(pg, a, EP("dev-ok"), { device: mine });
    const s2 = await add(pg, a, EP("dev-other"), { device: theirs });
    const s3 = await add(pg, a, EP("dev-gone"), { device: gone });
    const dev = async (id: string) =>
      (
        await rows<{ device_id: string | null }>(pg, "select device_id from public.push_subscriptions where id = $1", [
          id,
        ])
      )[0]!.device_id;
    expect(await dev(s1.id)).toBe(mine);
    expect(await dev(s2.id)).toBeNull();
    expect(await dev(s3.id)).toBeNull();
  });

  it("keeps the 10 newest subscriptions per user", async () => {
    const u = await createUser(pg);
    for (let i = 1; i <= 12; i++)
      await add(pg, u, EP(`cap-${i}`), {
        now: `2026-11-12T0${Math.floor(i / 10)}:${String(i % 10).padStart(2, "0")}:00+07:00`,
      });
    expect(await subCount(pg, u)).toBe(10);
    const eps = (
      await rows<{ endpoint: string }>(pg, "select endpoint from public.push_subscriptions where user_id = $1", [u])
    ).map((r) => r.endpoint);
    expect(eps).not.toContain(EP("cap-1"));
    expect(eps).not.toContain(EP("cap-2"));
    expect(eps).toContain(EP("cap-12"));
  });

  describe("delete (SECURITY-04)", () => {
    it("removes the owner's own subscription", async () => {
      const s = await add(pg, a, EP("del-own"));
      await pg.query("select app_private.remove_push_subscription($1::uuid, $2::uuid)", [a, s.id]);
      expect((await rows(pg, "select 1 from public.push_subscriptions where id = $1", [s.id])).length).toBe(0);
    });

    it("another user's id answers NOT_FOUND and the subscription stays", async () => {
      const s = await add(pg, b, EP("del-theirs"));
      const r = await attempt(pg, "select app_private.remove_push_subscription($1::uuid, $2::uuid)", [a, s.id]);
      expect(r).toMatchObject({ ok: false, error: { message: "NOT_FOUND" } });
      expect(
        (await rows(pg, "select 1 from public.push_subscriptions where id = $1 and user_id = $2", [s.id, b])).length,
      ).toBe(1);
    });

    it("an id that never existed answers exactly like someone else's", async () => {
      const s = await add(pg, b, EP("del-same"));
      const foreign = await attempt(pg, "select app_private.remove_push_subscription($1::uuid, $2::uuid)", [a, s.id]);
      const missing = await attempt(pg, "select app_private.remove_push_subscription($1::uuid, $2::uuid)", [
        a,
        "00000000-0000-4000-8000-0000000000ff",
      ]);
      expect(foreign).toEqual(missing);
    });

    it("works through the browser role and stays scoped: B cannot remove A's row", async () => {
      const s = await add(pg, a, EP("role-a"));
      const denied = await as(pg, "authenticated", b, () =>
        attempt(pg, "select public.remove_push_subscription($1::uuid)", [s.id]),
      );
      expect(denied).toMatchObject({ ok: false, error: { message: "NOT_FOUND" } });
      expect((await rows(pg, "select 1 from public.push_subscriptions where id = $1", [s.id])).length).toBe(1);
      const ok = await as(pg, "authenticated", a, () =>
        attempt(pg, "select public.remove_push_subscription($1::uuid)", [s.id]),
      );
      expect(ok.ok).toBe(true);
      expect((await rows(pg, "select 1 from public.push_subscriptions where id = $1", [s.id])).length).toBe(0);
    });

    it("is allowed without access: stopping notifications is always possible", async () => {
      const u = await createUser(pg);
      const s = await add(pg, u, EP("no-access"));
      await pg.query("update public.access_entitlements set status = 'suspended' where user_id = $1", [u]);
      const ok = await as(pg, "authenticated", u, () =>
        attempt(pg, "select public.remove_push_subscription($1::uuid)", [s.id]),
      );
      expect(ok.ok).toBe(true);
    });

    it("the browser role cannot read keys or write the table directly", async () => {
      const s = await add(pg, a, EP("direct"));
      const key = await as(pg, "authenticated", a, () => attempt(pg, "select p256dh from public.push_subscriptions"));
      expect(key).toMatchObject({ ok: false, error: { code: "42501" } });
      const del = await as(pg, "authenticated", b, () =>
        attempt(pg, "delete from public.push_subscriptions where id = $1", [s.id]),
      );
      expect(del).toMatchObject({ ok: false, error: { code: "42501" } });
      const ins = await as(pg, "authenticated", a, () =>
        attempt(
          pg,
          "insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://x.test/1', 'k', 's')",
          [a],
        ),
      );
      expect(ins).toMatchObject({ ok: false, error: { code: "42501" } });
    });
  });

  it("a device that is logged out or removed loses its push subscription", async () => {
    const d1 = await device(pg, a, "Ponsel");
    const d2 = await device(pg, a, "Tablet");
    const s1 = await add(pg, a, EP("logout-1"), { device: d1 });
    const s2 = await add(pg, a, EP("logout-2"), { device: d2 });
    await pg.query("select app_private.logout_device($1::uuid, $2::uuid, $3::timestamptz)", [a, d1, NOW]);
    expect((await rows(pg, "select 1 from public.push_subscriptions where id = $1", [s1.id])).length).toBe(0);
    await pg.query("select app_private.revoke_device($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)", [a, d1, d2, NOW]);
    expect((await rows(pg, "select 1 from public.push_subscriptions where id = $1", [s2.id])).length).toBe(0);
  });

  it("only the listed wrappers exist for the browser role; anon has none", async () => {
    for (const fn of ["add_push_subscription($1,$2,$3,$4)", "remove_push_subscription($1)"]) {
      const r = await as(pg, "anon", null, () =>
        attempt(pg, `select public.${fn}`, ["a", "b", "c", "d"].slice(0, fn.split(",").length)),
      );
      expect(r.ok, fn).toBe(false);
    }
    const r = await as(pg, "authenticated", a, () =>
      attempt(pg, "select app_private.add_push_subscription($1::uuid, now(), null, 'https://x.test/1', 'k', 's')", [a]),
    );
    expect(r).toMatchObject({ ok: false, error: { code: "42501" } });
  });
});

describe("notification history (PRD §19.7)", () => {
  let pg: PGlite;
  let a: string;
  let b: string;
  let tpl: string;
  const job = (
    uid: string,
    type: string,
    scheduled: string,
    status: string,
    key: string,
    template: string | null = null,
  ) =>
    pg.query(
      `insert into public.notification_jobs (user_id, notification_type, scheduled_at, expires_at, local_schedule_date, status, dedupe_key, template_id)
       values ($1, $2, $3::timestamptz, $3::timestamptz + interval '20 minutes', ($3::timestamptz at time zone 'Asia/Jakarta')::date, $4, $5, $6)`,
      [uid, type, scheduled, status, key, template],
    );
  beforeAll(async () => {
    pg = await createTestDb();
    a = await createUser(pg);
    b = await createUser(pg);
    tpl = (
      await rows<{ id: string }>(
        pg,
        "insert into public.notification_templates (category, title, body) values ('tahajud', 'Waktunya tahajud', 'Bangun yuk, sebentar saja.') returning id",
      )
    )[0]!.id;
    await job(a, "tahajud", at(12, "03:00"), "sent", "a:tahajud:12", tpl);
    await job(a, "bedtime", at(11, "22:00"), "sent", "a:bedtime:11");
    await job(a, "fajr", at(12, "04:30"), "pending", "a:fajr:12");
    await job(a, "alkahfi", at(10, "05:00"), "skipped", "a:alkahfi:10");
    await job(a, "bedtime", at(9, "22:00"), "expired", "a:bedtime:9");
    await job(a, "bedtime", at(10, "22:00"), "failed", "a:bedtime:10");
    await job(a, "bedtime", "2026-09-01T22:00:00+07:00", "sent", "a:bedtime:old");
    await job(b, "tahajud", at(12, "03:00"), "sent", "b:tahajud:12");
  });
  afterAll(async () => pg.close());

  const list = (uid: string, limit: number | null = null) =>
    q<{ notifications: { id: string; type: string; sent_for: string; title: string | null; body: string | null }[] }>(
      pg,
      uid,
      NOW,
      "list_notifications",
      [limit],
      ["int"],
    );

  it("lists only what was sent in the last 30 days, newest first", async () => {
    const r = await list(a);
    expect(r.notifications.map((n) => n.type)).toEqual(["tahajud", "bedtime"]);
    expect(r.notifications[0]!.sent_for).toBe("2026-11-11T20:00:00.000Z");
  });

  it("joins the template text, and leaves it null when the job has none", async () => {
    const [first, second] = (await list(a)).notifications;
    expect(first).toMatchObject({ title: "Waktunya tahajud", body: "Bangun yuk, sebentar saja." });
    expect(second).toMatchObject({ title: null, body: null });
  });

  it("never shows another user's notifications", async () => {
    const r = await list(b);
    expect(r.notifications).toHaveLength(1);
    const ids = (await list(a)).notifications.map((n) => n.id);
    expect(ids).not.toContain(r.notifications[0]!.id);
  });

  it("clamps the limit to 1..50 and defaults to 20", async () => {
    expect((await list(a, 1)).notifications).toHaveLength(1);
    expect((await list(a, 0)).notifications).toHaveLength(1);
    expect((await list(a, 9999)).notifications).toHaveLength(2);
    const u = await createUser(pg);
    for (let i = 0; i < 60; i++) {
      await job(
        u,
        "bedtime",
        `2026-11-${String(1 + (i % 28)).padStart(2, "0")}T${String(10 + Math.floor(i / 28)).padStart(2, "0")}:00:00+07:00`,
        "sent",
        `u:${i}`,
      );
    }
    expect(
      (await q<{ notifications: unknown[] }>(pg, u, NOW, "list_notifications", [null], ["int"])).notifications,
    ).toHaveLength(20);
    expect(
      (await q<{ notifications: unknown[] }>(pg, u, NOW, "list_notifications", [999], ["int"])).notifications,
    ).toHaveLength(50);
  });

  it("is empty for a user with no history, and needs access", async () => {
    expect((await list(await createUser(pg))).notifications).toEqual([]);
    const u = await createUser(pg, { entitlement: "suspended" });
    await fail(pg, u, NOW, "list_notifications", [20], ["int"], "ENTITLEMENT_INACTIVE");
  });
});

describe("prayer times (PRD §19.3)", () => {
  let pg: PGlite;
  let uid: string;
  let jkt: string;
  let mks: string;
  beforeAll(async () => {
    pg = await createTestDb();
    uid = await createUser(pg);
    jkt = (await rows<{ id: string }>(pg, "select id from public.regions where provider_region_code = 'DEMO-JKT'"))[0]!
      .id;
    mks = (
      await rows<{ id: string }>(
        pg,
        "insert into public.regions (province_name, city_name, provider_region_code, timezone) values ('Sulawesi Selatan', 'Makassar', 'T-MKS', 'Asia/Makassar') returning id",
      )
    )[0]!.id;
    for (const n of [10, 11, 12, 13, 15]) {
      await pg.query(
        `insert into public.prayer_times (region_id, local_date, fajr_at, maghrib_at, provider, fetched_at, valid_until, verification, attribution)
         values ($1, $2::date, ($2::date + time '04:30')::timestamp at time zone 'Asia/Jakarta', ($2::date + time '17:55')::timestamp at time zone 'Asia/Jakarta',
                 'prov-a', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', 'verified', 'Sumber: contoh')`,
        [jkt, day(n)],
      );
    }
    // the 14th was fetched twice: the newer row wins
    await pg.query(
      `insert into public.prayer_times (region_id, local_date, fajr_at, provider, fetched_at, valid_until)
       values ($1, '2026-11-14', '2026-11-13T21:30:00Z', 'old', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'),
              ($1, '2026-11-14', '2026-11-13T21:31:00Z', 'new', '2026-11-05T00:00:00Z', '2026-12-01T00:00:00Z')`,
      [jkt],
    );
    // 2026-11-16 is stored but past its refresh time
    await pg.query(
      `insert into public.prayer_times (region_id, local_date, fajr_at, provider, fetched_at, valid_until)
       values ($1, '2026-11-16', '2026-11-15T21:30:00Z', 'prov-a', '2026-10-01T00:00:00Z', '2026-11-10T00:00:00Z')`,
      [jkt],
    );
  });
  afterAll(async () => pg.close());

  type Day = {
    local_date: string;
    fajr_at: string;
    maghrib_at: string | null;
    source: string;
    cache_status: string;
    fetched_at: string;
    verification: string | null;
    attribution: string | null;
  };
  type Res = { region: { id: string; name: string; timezone: string }; days: Day[] };
  const get = (u: string, region: string | null, from: string | null, to: string | null, maghrib = false) =>
    q<Res>(pg, u, NOW, "get_prayer_times", [region, from, to, maghrib], ["uuid", "date", "date", "boolean"]);

  it("defaults to the user's own region and to today", async () => {
    const r = await get(uid, null, null, null);
    expect(r.region).toMatchObject({ id: jkt, timezone: "Asia/Jakarta" });
    expect(r.days.map((d) => d.local_date)).toEqual([day(12)]);
  });

  it("returns a range in date order and leaves out days that have no row", async () => {
    const r = await get(uid, jkt, day(10), day(16));
    expect(r.days.map((d) => d.local_date)).toEqual([day(10), day(11), day(12), day(13), day(14), day(15), day(16)]);
    const none = await get(uid, jkt, day(20), day(22));
    expect(none.days).toEqual([]);
  });

  it("gives Fajr as UTC and Maghrib only when asked", async () => {
    const without = (await get(uid, jkt, day(12), day(12))).days[0]!;
    expect(without.fajr_at).toBe("2026-11-11T21:30:00.000Z");
    expect(without.maghrib_at).toBeNull();
    const withM = (await get(uid, jkt, day(12), day(12), true)).days[0]!;
    expect(withM.maghrib_at).toBe("2026-11-12T10:55:00.000Z");
  });

  it("carries source, cross-check and attribution as stored, and nothing else about the provider", async () => {
    const d = (await get(uid, jkt, day(12), day(12))).days[0]!;
    expect(d).toMatchObject({
      source: "provider",
      cache_status: "fresh",
      verification: "verified",
      attribution: "Sumber: contoh",
    });
    expect(Object.keys(d).sort()).toEqual([
      "attribution",
      "cache_status",
      "fajr_at",
      "fetched_at",
      "local_date",
      "maghrib_at",
      "source",
      "verification",
    ]);
    expect(JSON.stringify(d)).not.toContain("prov-a");
  });

  it("takes the newest fetch when a day has several rows", async () => {
    expect((await get(uid, jkt, day(14), day(14))).days[0]!.fajr_at).toBe("2026-11-13T21:31:00.000Z");
  });

  it("marks a row past its refresh time as cached, still the provider's numbers", async () => {
    expect((await get(uid, jkt, day(16), day(16))).days[0]).toMatchObject({
      cache_status: "cached",
      source: "provider",
    });
  });

  it("another region's times can be asked for by id, in that region's timezone", async () => {
    const r = await get(uid, mks, null, null);
    expect(r.region).toMatchObject({ id: mks, timezone: "Asia/Makassar" });
    expect(r.days).toEqual([]);
  });

  it("refuses an unknown region, an unsupported one, and a backwards or too long range", async () => {
    await fail(
      pg,
      uid,
      NOW,
      "get_prayer_times",
      ["00000000-0000-4000-8000-0000000000ff", null, null, false],
      ["uuid", "date", "date", "boolean"],
      "NOT_FOUND",
    );
    await pg.query("update public.regions set is_supported = false where id = $1", [mks]);
    await fail(
      pg,
      uid,
      NOW,
      "get_prayer_times",
      [mks, null, null, false],
      ["uuid", "date", "date", "boolean"],
      "NOT_FOUND",
    );
    await pg.query("update public.regions set is_supported = true where id = $1", [mks]);
    await fail(
      pg,
      uid,
      NOW,
      "get_prayer_times",
      [jkt, day(12), day(10), false],
      ["uuid", "date", "date", "boolean"],
      "VALIDATION_ERROR",
    );
    await fail(
      pg,
      uid,
      NOW,
      "get_prayer_times",
      [jkt, day(1), "2026-12-30", false],
      ["uuid", "date", "date", "boolean"],
      "VALIDATION_ERROR",
    );
    // 45 days is fine, 46 is not
    expect((await get(uid, jkt, day(1), "2026-12-15")).days.length).toBeGreaterThan(0);
    await fail(
      pg,
      uid,
      NOW,
      "get_prayer_times",
      [jkt, day(1), "2026-12-16", false],
      ["uuid", "date", "date", "boolean"],
      "VALIDATION_ERROR",
    );
  });

  it("a user with no region and no region id gets LOCATION_REQUIRED, not an invented schedule", async () => {
    const u = await createUser(pg, { region: null });
    await fail(
      pg,
      u,
      NOW,
      "get_prayer_times",
      [null, null, null, false],
      ["uuid", "date", "date", "boolean"],
      "LOCATION_REQUIRED",
    );
  });

  it("needs access", async () => {
    for (const ent of ["suspended", "expired", "none"] as const) {
      const u = await createUser(pg, { entitlement: ent });
      await fail(
        pg,
        u,
        NOW,
        "get_prayer_times",
        [null, null, null, false],
        ["uuid", "date", "date", "boolean"],
        "ENTITLEMENT_INACTIVE",
      );
    }
  });
});

/** Everything that identifies a user, put in one place so export and delete are checked against the same data. */
async function populate(pg: PGlite, uid: string, email: string) {
  for (const n of [2, 3]) {
    const s = await startSession(pg, uid, at(n));
    await completeSession(pg, uid, s.session_id, at(n));
  }
  const s12 = await startSession(pg, uid, NOW);
  await applyOp(pg, uid, NOW, await activityId(pg, s12.session_id, "istighfar"), `exp-${uid}`, "delta", 7);
  await q(pg, uid, NOW, "add_excuse", [day(9), null], ["date", "date"]);
  await q(pg, uid, NOW, "put_quran_progress", [18, 12], ["int", "int"]);
  await q(
    pg,
    uid,
    NOW,
    "put_notification_prefs",
    [
      JSON.stringify({
        bedtime: { enabled: true, target_sleep_time: "22:00", offset_minutes: 30 },
        tahajud: { enabled: true },
        fajr: { enabled: false },
        alkahfi: { enabled: true },
        achievement: { enabled: true },
        quiet_hours: { enabled: false, start: "22:00", end: "04:00", allow_worship: true },
      }),
    ],
    ["jsonb"],
  );
  const dev = await device(pg, uid, "Chrome di Android");
  await add(pg, uid, EP(`pop-${uid}`), { device: dev, p256dh: `SECRET-P256DH-${uid}`, auth: `SECRET-AUTH-${uid}` });
  await pg.query(
    `insert into public.device_sessions (device_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '30 days')`,
    [dev, uid, `SECRET-TOKEN-HASH-${uid}`],
  );
  await pg.query(
    `insert into public.notification_jobs (user_id, notification_type, scheduled_at, expires_at, local_schedule_date, status, dedupe_key)
     values ($1, 'tahajud', $2::timestamptz, $2::timestamptz + interval '20 minutes', '2026-11-12', 'sent', $3)`,
    [uid, at(12, "03:00"), `${uid}:tahajud:2026-11-12`],
  );
  await pg.query(
    `insert into public.session_quran_completions (user_id, session_id, surah_number, completion_type)
     select $1, id, 18, 'finished' from public.night_sessions where user_id = $1 and fajr_local_date = '2026-11-12'`,
    [uid],
  );
  const order = (
    await rows<{ id: string }>(
      pg,
      `insert into public.purchase_orders (scalev_order_id, customer_email_normalized, buyer_name, payment_status, amount, verified_via, payment_verified_at)
       values ($1, $2, 'Nama Pembeli', 'paid', 99000, 'scalev_api', now()) returning id`,
      [`SC-${uid.slice(-4)}`, email],
    )
  )[0]!.id;
  await pg.query(
    "insert into public.purchase_order_items (purchase_order_id, product_id, quantity) values ($1, 'tahajud-tracker', 1)",
    [order],
  );
  await pg.query("update public.access_entitlements set purchase_order_id = $2 where user_id = $1", [uid, order]);
}

const exportOf = async (pg: PGlite, uid: string, now = NOW) =>
  dataExportSchema.parse(await q(pg, uid, now, "export_user_data"));

describe("data export (PRD §24.4, PRIV-02)", () => {
  let pg: PGlite;
  let uid: string;
  let other: string;
  beforeAll(async () => {
    pg = await createTestDb();
    uid = await createUser(pg, { email: "pemilik@ngajigaes.test" });
    other = await createUser(pg, { email: "lain@ngajigaes.test" });
    await populate(pg, uid, "pemilik@ngajigaes.test");
    await populate(pg, other, "lain@ngajigaes.test");
  });
  afterAll(async () => pg.close());

  it("has every section, matches the shared schema, and carries the user's own data", async () => {
    const x = await exportOf(pg, uid);
    expect(x.format_version).toBe(1);
    expect(x.account.email).toBe("pemilik@ngajigaes.test");
    expect(x.account.region?.name).toBeTruthy();
    expect(x.access).toHaveLength(1);
    expect(x.purchases).toMatchObject([
      { currency: "IDR", payment_status: "paid", items: [{ product_id: "tahajud-tracker", quantity: 1 }] },
    ]);
    expect(x.sessions.map((s) => s.session_key)).toEqual([day(2), day(3), day(12)]);
    expect(x.sessions.at(-1)!.activities.find((a) => a.key === "istighfar")).toMatchObject({ count: 7 });
    expect(x.sessions.at(-1)!.activities.find((a) => a.key === "istighfar")!.operations).toMatchObject([
      { type: "delta", delta: 7, resulting_count: 7 },
    ]);
    expect(x.level_state?.current_level).toBeGreaterThanOrEqual(1);
    expect(x.excused_dates).toEqual([day(9)]);
    expect(x.quran_progress).toMatchObject([{ surah: 18, ayah: 12 }]);
    expect(x.quran_completions).toMatchObject([{ surah: 18, session_key: day(12), type: "finished" }]);
    expect(x.notification_preferences?.fajr.enabled).toBe(false);
    expect(x.push_subscriptions).toHaveLength(1);
    expect(x.devices).toMatchObject([{ label: "Chrome di Android", revoked_at: null }]);
    expect(x.notifications).toMatchObject([{ type: "tahajud", status: "sent" }]);
  });

  it("leaves out secrets: no push endpoint or keys, no cookie hash", async () => {
    const text = JSON.stringify(await q(pg, uid, NOW, "export_user_data"));
    for (const secret of [
      "SECRET-P256DH",
      "SECRET-AUTH",
      "SECRET-TOKEN-HASH",
      "push.example.test",
      "token_hash",
      "p256dh",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("holds nothing of another user", async () => {
    const text = JSON.stringify(await q(pg, uid, NOW, "export_user_data"));
    expect(text).not.toContain("lain@ngajigaes.test");
    expect(text).not.toContain(other);
    expect(text).not.toContain(`SC-${other.slice(-4)}`);
  });

  it("works for a user whose access has ended: the data is still theirs", async () => {
    await pg.query("update public.access_entitlements set status = 'revoked' where user_id = $1", [uid]);
    const x = await exportOf(pg, uid);
    expect(x.sessions).toHaveLength(3);
    expect(x.access[0]!.status).toBe("revoked");
    await pg.query("update public.access_entitlements set status = 'active' where user_id = $1", [uid]);
  });

  it("is not reachable from the browser role", async () => {
    const r = await as(pg, "authenticated", uid, () =>
      attempt(pg, "select app_private.export_user_data($1::uuid, now())", [uid]),
    );
    expect(r).toMatchObject({ ok: false, error: { code: "42501" } });
    const wrapper = await as(pg, "authenticated", uid, () => attempt(pg, "select public.export_user_data()"));
    expect(wrapper.ok).toBe(false);
  });

  it("refuses an unknown user and a missing one", async () => {
    await fail(pg, "00000000-0000-4000-8000-0000000000ee", NOW, "export_user_data", [], [], "NOT_FOUND");
    await fail(pg, null, NOW, "export_user_data", [], [], "UNAUTHENTICATED");
  });
});

describe("delete account (PRD §24.4, PRIV-02)", () => {
  let pg: PGlite;
  let uid: string;
  let other: string;
  const EMAIL = "Hapus.Saya+tes@ngajigaes.test".toLowerCase();
  const HASH = "deleted:0123456789abcdef0123456789abcdef";
  const del = (u: string, hash = HASH, now = NOW) =>
    q<{ deleted_at: string }>(pg, u, now, "delete_account", [hash], ["text"]);

  beforeAll(async () => {
    pg = await createTestDb();
    uid = await createUser(pg, { email: EMAIL });
    other = await createUser(pg, { email: "tetap@ngajigaes.test" });
    await populate(pg, uid, EMAIL);
    await populate(pg, other, "tetap@ngajigaes.test");
    await pg.query(
      "insert into public.email_outbox (to_email, template_key, payload) values ($1, 'access', '{\"name\":\"Hapus Saya\"}'), ('tetap@ngajigaes.test', 'access', '{}')",
      [EMAIL],
    );
    await pg.query(
      `insert into public.webhook_events (provider, external_event_id, event_type, payload_minimal, payload_sha256)
       values ('scalev', 'ev-1', 'payment.received', $1::jsonb, 'x'), ('scalev', 'ev-2', 'payment.received', $2::jsonb, 'y')`,
      [
        JSON.stringify({ customer: { email: "HAPUS.saya+TES@ngajigaes.test" }, total: 99000 }),
        JSON.stringify({ customer: { email: "tetap@ngajigaes.test" } }),
      ],
    );
    await pg.query(
      `insert into public.jobs (job_type, payload, status) values
       ('send_access_email', $1::jsonb, 'queued'), ('send_access_email', $2::jsonb, 'failed'), ('send_access_email', $3::jsonb, 'queued'),
       ('send_access_email', $1::jsonb, 'done')`,
      [JSON.stringify({ user_id: uid }), JSON.stringify({ email: EMAIL }), JSON.stringify({ user_id: other })],
    );
    await pg.query(
      "insert into public.session_audit_logs (session_id, actor_id, operation_type) select id, $1, 'x' from public.night_sessions where user_id = $1 limit 1",
      [uid],
    );
  });
  afterAll(async () => pg.close());

  it("removes every row of the user from every table that has a user_id, except what the law lets us keep", async () => {
    const out = await del(uid);
    expect(out.deleted_at).toBe("2026-11-11T19:00:00.000Z");
    const tables = await rows<{ table_name: string }>(
      pg,
      `select c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
       where c.table_schema = 'public' and c.column_name = 'user_id' and t.table_type = 'BASE TABLE' order by 1`,
    );
    expect(tables.length).toBeGreaterThanOrEqual(14);
    const KEPT = new Set(["data_deletion_requests"]); // only the user id and when: proof the request was handled
    for (const { table_name } of tables) {
      if (KEPT.has(table_name)) continue;
      const n = Number(
        (await rows<{ n: string }>(pg, `select count(*) as n from public.${table_name} where user_id = $1`, [uid]))[0]!
          .n,
      );
      expect(n, table_name).toBe(0);
    }
    expect((await rows(pg, "select 1 from auth.users where id = $1", [uid])).length).toBe(0);
    expect((await rows(pg, "select 1 from public.profiles where email_normalized = $1", [EMAIL])).length).toBe(0);
  });

  it("removes dependent rows too: operations, activities, completions, device cookies, subscriptions", async () => {
    for (const t of [
      "counter_operations",
      "session_activities",
      "session_quran_completions",
      "device_sessions",
      "push_subscriptions",
      "user_devices",
      "notification_jobs",
      "session_excuses",
    ]) {
      const n = Number(
        (await rows<{ n: string }>(pg, `select count(*) as n from public.${t} where user_id = $1`, [uid]))[0]!.n,
      );
      expect(n, t).toBe(0);
    }
  });

  it("keeps the order and the entitlement for the business records, with the email replaced by the hash", async () => {
    const e = await rows<{ user_id: string | null; email_normalized: string; status: string }>(
      pg,
      "select user_id, email_normalized, status from public.access_entitlements where email_normalized = $1",
      [HASH],
    );
    expect(e).toEqual([{ user_id: null, email_normalized: HASH, status: "active" }]);
    const o = await rows<{
      customer_email_normalized: string;
      buyer_name: string | null;
      payment_status: string;
      amount: string;
    }>(
      pg,
      "select customer_email_normalized, buyer_name, payment_status, amount from public.purchase_orders where customer_email_normalized = $1",
      [HASH],
    );
    expect(o).toMatchObject([{ buyer_name: null, payment_status: "paid" }]);
    expect(Number(o[0]!.amount)).toBe(99000);
    expect(
      (
        await rows(
          pg,
          "select 1 from public.purchase_order_items i join public.purchase_orders o on o.id = i.purchase_order_id where o.customer_email_normalized = $1",
          [HASH],
        )
      ).length,
    ).toBe(1);
  });

  it("no copy of the address is left anywhere we keep records", async () => {
    for (const [t, c] of [
      ["access_entitlements", "email_normalized"],
      ["access_entitlements", "transferred_from_email"],
      ["purchase_orders", "customer_email_normalized"],
      ["email_outbox", "to_email"],
    ] as const) {
      const n = Number(
        (await rows<{ n: string }>(pg, `select count(*) as n from public.${t} where lower(${c}) = $1`, [EMAIL]))[0]!.n,
      );
      expect(n, `${t}.${c}`).toBe(0);
    }
    const hook = await rows<{ payload_minimal: unknown }>(
      pg,
      "select payload_minimal from public.webhook_events where external_event_id = 'ev-1'",
    );
    expect(JSON.stringify(hook[0]!.payload_minimal).toLowerCase()).not.toContain("hapus.saya");
    expect(JSON.stringify(hook[0]!.payload_minimal)).toContain(HASH);
    expect(JSON.stringify(hook[0]!.payload_minimal)).toContain("99000");
    const mail = await rows<{ payload: unknown }>(pg, "select payload from public.email_outbox where to_email = $1", [
      HASH,
    ]);
    expect(mail).toEqual([{ payload: {} }]);
  });

  it("drops work still waiting for the person, and keeps everyone else's", async () => {
    const left = await rows<{ status: string; payload: { user_id?: string; email?: string } }>(
      pg,
      "select status, payload from public.jobs order by status",
    );
    const waiting = left
      .filter((j) => j.status === "queued" || j.status === "failed")
      .map((j) => j.payload.user_id ?? j.payload.email);
    expect(waiting).toEqual([other]);
    // a finished job is history, not work waiting: it keeps a user id that no longer points at anything
    expect(left.filter((j) => j.status === "done")).toHaveLength(1);
  });

  it("clears the user id from audit rows and writes one deletion record", async () => {
    expect((await rows(pg, "select 1 from public.session_audit_logs where actor_id = $1", [uid])).length).toBe(0);
    const r = await rows<{ status: string; processed_at: string | null }>(
      pg,
      "select status, processed_at from public.data_deletion_requests where user_id = $1",
      [uid],
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe("done");
    expect(r[0]!.processed_at).not.toBeNull();
  });

  it("does not touch anyone else", async () => {
    const x = await exportOf(pg, other);
    expect(x.account.email).toBe("tetap@ngajigaes.test");
    expect(x.sessions).toHaveLength(3);
    expect(x.access).toHaveLength(1);
    expect(x.purchases).toHaveLength(1);
    expect(x.push_subscriptions).toHaveLength(1);
    expect((await rows(pg, "select 1 from public.email_outbox where to_email = 'tetap@ngajigaes.test'")).length).toBe(
      1,
    );
    expect(
      JSON.stringify(
        (await rows(pg, "select payload_minimal from public.webhook_events where external_event_id = 'ev-2'"))[0],
      ),
    ).toContain("tetap@ngajigaes.test");
  });

  it("deleting again answers NOT_FOUND and changes nothing", async () => {
    await fail(pg, uid, NOW, "delete_account", [HASH], ["text"], "NOT_FOUND");
    expect(
      Number(
        (
          await rows<{ n: string }>(pg, "select count(*) as n from public.data_deletion_requests where user_id = $1", [
            uid,
          ])
        )[0]!.n,
      ),
    ).toBe(1);
  });

  it("works for a user without active access, and for one who never had any", async () => {
    for (const ent of ["suspended", "expired", "none", "pending_verification"] as const) {
      const u = await createUser(pg, { entitlement: ent });
      const out = await del(u, `deleted:${ent.padEnd(32, "0")}`);
      expect(out.deleted_at).toBeTruthy();
      expect((await rows(pg, "select 1 from auth.users where id = $1", [u])).length).toBe(0);
    }
  });

  it("refuses a weak or missing hash and a missing user, and rolls back completely", async () => {
    const u = await createUser(pg);
    await fail(pg, u, NOW, "delete_account", [null], ["text"], "VALIDATION_ERROR");
    await fail(pg, u, NOW, "delete_account", ["short"], ["text"], "VALIDATION_ERROR");
    await fail(pg, null, NOW, "delete_account", [HASH], ["text"], "UNAUTHENTICATED");
    expect((await rows(pg, "select 1 from auth.users where id = $1", [u])).length).toBe(1);
    expect((await rows(pg, "select 1 from public.access_entitlements where user_id = $1", [u])).length).toBe(1);
  });

  it("an unlinked entitlement for the same email is anonymised too", async () => {
    const email = "belum.login@ngajigaes.test";
    const u = await createUser(pg, { email, entitlement: "none" });
    await pg.query(
      "insert into public.access_entitlements (email_normalized, status, starts_at, transferred_from_email) values ($1, 'active', now(), $1), ($2, 'active', now(), $1)",
      [email, "orang.lain@ngajigaes.test"],
    );
    await del(u, "deleted:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(
      (
        await rows(
          pg,
          "select 1 from public.access_entitlements where lower(email_normalized) = $1 or lower(transferred_from_email) = $1",
          [email],
        )
      ).length,
    ).toBe(0);
    // the other person's row stays theirs; only the reference to the deleted address changed
    expect(
      (await rows(pg, "select 1 from public.access_entitlements where email_normalized = 'orang.lain@ngajigaes.test'"))
        .length,
    ).toBe(1);
  });

  it("is not reachable from the browser role or anon", async () => {
    const u = await createUser(pg);
    const r = await as(pg, "authenticated", u, () =>
      attempt(pg, "select app_private.delete_account($1::uuid, now(), 'deleted:0123456789abcdef')", [u]),
    );
    expect(r).toMatchObject({ ok: false, error: { code: "42501" } });
    const w = await as(pg, "authenticated", u, () => attempt(pg, "select public.delete_account()"));
    expect(w.ok).toBe(false);
    expect((await rows(pg, "select 1 from auth.users where id = $1", [u])).length).toBe(1);
  });
});

describe("wrappers for the browser role read the server clock", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });
  afterAll(async () => pg.close());

  it("list_notifications, get_prayer_times and add_push_subscription work through public.*, with RLS in force", async () => {
    const u = await createUser(pg);
    const added = await as(pg, "authenticated", u, () =>
      rows<{ r: { id: string } }>(
        pg,
        "select public.add_push_subscription(null, 'https://push.example.test/x', 'k', 's') as r",
      ),
    );
    expect(added[0]!.r.id).toBeTruthy();
    const list = await as(pg, "authenticated", u, () =>
      rows<{ r: { notifications: unknown[] } }>(pg, "select public.list_notifications() as r"),
    );
    expect(list[0]!.r.notifications).toEqual([]);
    const times = await as(pg, "authenticated", u, () =>
      rows<{ r: { region: { timezone: string } } }>(pg, "select public.get_prayer_times() as r"),
    );
    expect(times[0]!.r.region.timezone).toBe("Asia/Jakarta");
  });

  it("a request with no signed-in user is UNAUTHENTICATED", async () => {
    const r = await as(pg, "authenticated", null, () => attempt(pg, "select public.list_notifications()"));
    expect(r).toMatchObject({ ok: false, error: { message: "UNAUTHENTICATED" } });
  });
});
