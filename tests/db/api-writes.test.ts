import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addExcuse } from "@/domain/calendar/excuse";
import { notificationPreferencesSchema, profileSchema, quranProgressSchema, accessSchema } from "@/data/contracts";
import { as, attempt, completeSession, createTestDb, createUser, rows, startSession } from "./harness";

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
const fails = async (
  pg: PGlite,
  uid: string,
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

describe("excuse (berhalangan)", () => {
  let pg: PGlite;
  let uid: string;
  beforeAll(async () => {
    pg = await createTestDb();
    uid = await createUser(pg);
  });
  afterAll(async () => pg.close());

  it("adds one date and a range, returns the full sorted list, and is idempotent", async () => {
    const a = await q<{ excused_dates: string[] }>(pg, uid, NOW, "add_excuse", [day(3), null], ["date", "date"]);
    expect(a.excused_dates).toEqual([day(3)]);
    const b = await q<{ excused_dates: string[] }>(pg, uid, NOW, "add_excuse", [day(5), day(7)], ["date", "date"]);
    expect(b.excused_dates).toEqual([day(3), day(5), day(6), day(7)]);
    const c = await q<{ excused_dates: string[] }>(pg, uid, NOW, "add_excuse", [day(5), day(5)], ["date", "date"]);
    expect(c.excused_dates).toEqual([day(3), day(5), day(6), day(7)]);
    // same answer as the mock domain
    const d = addExcuse([day(3)], day(5), day(7));
    expect(d.ok && d.dates).toEqual([day(3), day(5), day(6), day(7)]);
  });

  it("refuses a backwards range and more than 15 days in one action, without saving anything", async () => {
    await fails(pg, uid, NOW, "add_excuse", [day(10), day(9)], ["date", "date"], "VALIDATION_ERROR");
    await fails(pg, uid, NOW, "add_excuse", [day(1), day(16)], ["date", "date"], "VALIDATION_ERROR");
    const ok = await q<{ excused_dates: string[] }>(pg, uid, NOW, "add_excuse", [day(20), day(30)], ["date", "date"]);
    expect(ok.excused_dates).toHaveLength(4 + 11);
    const edge = await attempt(
      pg,
      "select app_private.add_excuse($1::uuid, $2::timestamptz, '2026-12-01'::date, '2026-12-15'::date)",
      [uid, NOW],
    );
    expect(edge.ok).toBe(true); // exactly 15 days
  });

  it("is only the date: no reason or category column exists, and no role can read the table directly", async () => {
    const cols = await rows<{ column_name: string }>(
      pg,
      "select column_name from information_schema.columns where table_name = 'session_excuses' order by 1",
    );
    expect(cols.map((c) => c.column_name)).toEqual(["created_at", "excused_date", "user_id"]);
    const direct = await as(pg, "authenticated", uid, () => attempt(pg, "select * from public.session_excuses"));
    expect(direct).toMatchObject({ ok: false, error: { code: "42501" } });
    const insert = await as(pg, "authenticated", uid, () =>
      attempt(pg, "insert into public.session_excuses (user_id, excused_date) values ($1, '2026-11-20')", [uid]),
    );
    expect(insert).toMatchObject({ ok: false, error: { code: "42501" } });
  });

  it("changes the status of an existing session, keeps its progress, and audits a correction after cutoff", async () => {
    const u = await createUser(pg);
    const s = await startSession(pg, u, at(4));
    await completeSession(pg, u, s.session_id, at(4));
    expect(
      (await rows<{ status: string }>(pg, "select status from public.night_sessions where id = $1", [s.session_id]))[0]!
        .status,
    ).toBe("completed");
    await q(pg, u, at(5), "add_excuse", [day(4), null], ["date", "date"]); // after cutoff of 11-04
    expect(
      (await rows<{ status: string }>(pg, "select status from public.night_sessions where id = $1", [s.session_id]))[0]!
        .status,
    ).toBe("excused");
    expect(
      Number(
        (
          await rows<{ n: string }>(
            pg,
            "select count(*) as n from public.session_activities where session_id = $1 and status = 'done'",
            [s.session_id],
          )
        )[0]!.n,
      ),
    ).toBeGreaterThan(0);
    const audit = await rows<{ operation_type: string }>(
      pg,
      "select operation_type from public.session_audit_logs where session_id = $1",
      [s.session_id],
    );
    expect(audit.map((a) => a.operation_type)).toContain("excuse_added");
  });

  it("cancels inside the correction window and restores the status", async () => {
    const u = await createUser(pg);
    const s = await startSession(pg, u, at(4));
    await completeSession(pg, u, s.session_id, at(4));
    await q(pg, u, at(4), "add_excuse", [day(4), null], ["date", "date"]);
    const r = await q<{ excused_dates: string[] }>(pg, u, at(5), "cancel_excuse", [day(4)], ["date"]);
    expect(r.excused_dates).toEqual([]);
    expect(
      (await rows<{ status: string }>(pg, "select status from public.night_sessions where id = $1", [s.session_id]))[0]!
        .status,
    ).toBe("completed");
  });

  it("cannot cancel after the correction window, or a date that is not excused", async () => {
    const u = await createUser(pg);
    await q(pg, u, at(4), "add_excuse", [day(4), null], ["date", "date"]);
    // cutoff 11-04 12:00 + 48h = 11-06 12:00
    await fails(pg, u, at(6, "12:01"), "cancel_excuse", [day(4)], ["date"], "SESSION_LOCKED");
    expect(
      (await q<{ excused_dates: string[] }>(pg, u, at(6, "11:59"), "cancel_excuse", [day(4)], ["date"])).excused_dates,
    ).toEqual([]);
    await fails(pg, u, NOW, "cancel_excuse", [day(2)], ["date"], "NOT_FOUND");
  });

  it("needs an active entitlement", async () => {
    const u = await createUser(pg, { entitlement: "suspended" });
    await fails(pg, u, NOW, "add_excuse", [day(3), null], ["date", "date"], "ENTITLEMENT_INACTIVE");
    await fails(pg, u, NOW, "cancel_excuse", [day(3)], ["date"], "ENTITLEMENT_INACTIVE");
  });

  it("one user's excuse never touches another user's calendar", async () => {
    const u = await createUser(pg);
    const days = await q<{ days: { date: string; status: string }[] }>(
      pg,
      u,
      NOW,
      "calendar_json",
      [null, null],
      ["date", "date"],
    );
    expect(days.days.find((d) => d.date === day(3))!.status).toBe("missed");
  });
});

describe("profile, location, onboarding, preferences", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });
  afterAll(async () => pg.close());

  const regionId = async (code: string) =>
    (await rows<{ id: string }>(pg, "select id from public.regions where provider_region_code = $1", [code]))[0]!.id;

  it("shows the profile in the contract shape, with the program start hidden until onboarding is done", async () => {
    const u = await createUser(pg, { onboarded: false, region: null });
    const p = profileSchema.parse(await q(pg, u, NOW, "get_profile"));
    expect(p).toMatchObject({
      onboarding_completed: false,
      program_start_date: null,
      region_id: null,
      schedule_mode: "region",
      theme_pref: "system",
    });
  });

  it("updates the display name: trims, empty becomes null, 60 characters at most", async () => {
    const u = await createUser(pg);
    expect(((await q(pg, u, NOW, "update_profile", ["  Zen  "])) as { display_name: string }).display_name).toBe("Zen");
    expect(
      ((await q(pg, u, NOW, "update_profile", ["   "])) as { display_name: string | null }).display_name,
    ).toBeNull();
    await fails(pg, u, NOW, "update_profile", ["x".repeat(61)], [], "VALIDATION_ERROR");
  });

  it("updates only the display preferences that are sent", async () => {
    const u = await createUser(pg);
    const p = (await q(pg, u, NOW, "update_preferences", ["dark", null, 30], ["text", "int", "int"])) as {
      theme_pref: string;
      quran_font_size: number;
      dhikr_font_size: number;
    };
    expect(p).toMatchObject({ theme_pref: "dark", quran_font_size: 30, dhikr_font_size: 30 });
    await fails(pg, u, NOW, "update_preferences", ["neon", null, null], ["text", "int", "int"], "VALIDATION_ERROR");
    await fails(pg, u, NOW, "update_preferences", [null, 50, null], ["text", "int", "int"], "VALIDATION_ERROR");
    await fails(pg, u, NOW, "update_preferences", [null, null, 20], ["text", "int", "int"], "VALIDATION_ERROR");
  });

  it("sets a region, then a manual schedule, and back", async () => {
    const u = await createUser(pg, { region: null });
    const mks = await regionId("DEMO-MKS");
    await q(pg, u, NOW, "set_location", ["region", mks, null, null, null], ["text", "uuid", "text", "text", "text"]);
    expect(await rows(pg, "select app_private.user_timezone($1::uuid) as tz", [u])).toEqual([{ tz: "Asia/Makassar" }]);
    await q(
      pg,
      u,
      NOW,
      "set_location",
      ["manual", null, "Asia/Jakarta", "04:30", "17:55"],
      ["text", "uuid", "text", "text", "text"],
    );
    const p = profileSchema.parse(await q(pg, u, NOW, "get_profile"));
    expect(p).toMatchObject({ schedule_mode: "manual", region_id: null, timezone: "Asia/Jakarta" });
    const row = (await q(pg, u, NOW, "prayer_row_json", [day(13)], ["date"])) as Record<string, string>;
    expect(row).toMatchObject({
      mode: "manual",
      fajr_at: "2026-11-12T21:30:00.000Z",
      maghrib_at: "2026-11-13T10:55:00.000Z",
    });
    await q(pg, u, NOW, "set_location", ["region", mks, null, null, null], ["text", "uuid", "text", "text", "text"]);
    expect(((await q(pg, u, NOW, "get_profile")) as { schedule_mode: string }).schedule_mode).toBe("region");
  });

  it("refuses an unknown region, a bad timezone, bad times, and a missing fajr time", async () => {
    const u = await createUser(pg);
    const c = ["text", "uuid", "text", "text", "text"];
    await fails(
      pg,
      u,
      NOW,
      "set_location",
      ["region", "00000000-0000-4000-8000-0000000000ff", null, null, null],
      c,
      "NOT_FOUND",
    );
    await fails(pg, u, NOW, "set_location", ["manual", null, "Mars/Base", "04:30", null], c, "VALIDATION_ERROR");
    await fails(pg, u, NOW, "set_location", ["manual", null, "Asia/Jakarta", "25:00", null], c, "VALIDATION_ERROR");
    await fails(pg, u, NOW, "set_location", ["manual", null, "Asia/Jakarta", null, null], c, "VALIDATION_ERROR");
    await fails(pg, u, NOW, "set_location", ["fly", null, null, null, null], c, "VALIDATION_ERROR");
  });

  it("a location change applies from the next session: the existing row keeps its zone and region (BUG-08)", async () => {
    const u = await createUser(pg);
    const s = await startSession(pg, u, NOW);
    await q(
      pg,
      u,
      NOW,
      "set_location",
      ["region", await regionId("DEMO-MKS"), null, null, null],
      ["text", "uuid", "text", "text", "text"],
    );
    const row = (
      await rows<{ timezone: string }>(pg, "select timezone from public.night_sessions where id = $1", [s.session_id])
    )[0]!;
    expect(row.timezone).toBe("Asia/Jakarta");
  });

  it("completes onboarding once: start date is the active session, a second call changes nothing", async () => {
    const u = await createUser(pg, { onboarded: false });
    await pg.query("update public.profiles set program_start_date = null where user_id = $1", [u]);
    const first = profileSchema.parse(await q(pg, u, at(12, "03:00"), "complete_onboarding"));
    expect(first).toMatchObject({ onboarding_completed: true, program_start_date: day(12) });
    const again = profileSchema.parse(await q(pg, u, at(20), "complete_onboarding"));
    expect(again.program_start_date).toBe(day(12));
    expect(
      Number(
        (await rows<{ n: string }>(pg, "select count(*) as n from public.user_level_state where user_id = $1", [u]))[0]!
          .n,
      ),
    ).toBe(1);
  });

  it("after the cutoff the program starts with tomorrow's session", async () => {
    const u = await createUser(pg, { onboarded: false });
    await pg.query("update public.profiles set program_start_date = null where user_id = $1", [u]);
    expect(
      ((await q(pg, u, at(12, "13:00"), "complete_onboarding")) as { program_start_date: string }).program_start_date,
    ).toBe(day(13));
  });

  it("onboarding needs a location", async () => {
    const u = await createUser(pg, { onboarded: false, region: null });
    await fails(pg, u, NOW, "complete_onboarding", [], [], "LOCATION_REQUIRED");
  });
});

describe("notification preferences", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });
  afterAll(async () => pg.close());

  const prefs = {
    bedtime: { enabled: false, target_sleep_time: "21:30", offset_minutes: 45 },
    tahajud: { enabled: true },
    fajr: { enabled: false },
    alkahfi: { enabled: true },
    achievement: { enabled: false },
    quiet_hours: { enabled: true, start: "23:00", end: "03:30", allow_worship: false },
  };

  it("returns defaults before anything is saved, in the contract shape", async () => {
    const u = await createUser(pg);
    const d = notificationPreferencesSchema.parse(await q(pg, u, NOW, "get_notification_prefs"));
    expect(d).toEqual({
      bedtime: { enabled: true, target_sleep_time: "22:00", offset_minutes: 30 },
      tahajud: { enabled: true },
      fajr: { enabled: true },
      alkahfi: { enabled: true },
      achievement: { enabled: true },
      quiet_hours: { enabled: false, start: "22:00", end: "04:00", allow_worship: true },
    });
  });

  it("saves every field and reads the same values back, twice (upsert)", async () => {
    const u = await createUser(pg);
    const saved = notificationPreferencesSchema.parse(
      await q(pg, u, NOW, "put_notification_prefs", [JSON.stringify(prefs)], ["jsonb"]),
    );
    expect(saved).toEqual(prefs);
    const next = { ...prefs, tahajud: { enabled: false } };
    await q(pg, u, NOW, "put_notification_prefs", [JSON.stringify(next)], ["jsonb"]);
    expect(await q(pg, u, NOW, "get_notification_prefs")).toEqual(next);
  });

  it("refuses malformed values", async () => {
    const u = await createUser(pg);
    const bad = { ...prefs, bedtime: { ...prefs.bedtime, target_sleep_time: "soon" } };
    await fails(pg, u, NOW, "put_notification_prefs", [JSON.stringify(bad)], ["jsonb"], "VALIDATION_ERROR");
  });

  it("stays per user", async () => {
    const a = await createUser(pg);
    const b = await createUser(pg);
    await q(pg, a, NOW, "put_notification_prefs", [JSON.stringify(prefs)], ["jsonb"]);
    expect(((await q(pg, b, NOW, "get_notification_prefs")) as { fajr: { enabled: boolean } }).fajr.enabled).toBe(true);
  });
});

describe("Qur'an progress", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });
  afterAll(async () => pg.close());

  it("stores a position, replaces it, and lists only the caller's", async () => {
    const a = await createUser(pg);
    const b = await createUser(pg);
    quranProgressSchema.parse(await q(pg, a, NOW, "put_quran_progress", [18, 10], ["int", "int"]));
    await q(pg, a, NOW, "put_quran_progress", [18, 25], ["int", "int"]);
    await q(pg, a, NOW, "put_quran_progress", [36, null], ["int", "int"]);
    await q(pg, b, NOW, "put_quran_progress", [56, 3], ["int", "int"]);
    const list = (await q<{ progress: { surah: number; ayah: number | null }[] }>(pg, a, NOW, "get_quran_progress"))
      .progress;
    expect(list.map((p) => [p.surah, p.ayah])).toEqual([
      [18, 25],
      [36, null],
    ]);
  });

  it("refuses a surah outside 1..114 and an ayah below 1", async () => {
    const a = await createUser(pg);
    await fails(pg, a, NOW, "put_quran_progress", [0, 1], ["int", "int"], "NOT_FOUND");
    await fails(pg, a, NOW, "put_quran_progress", [115, 1], ["int", "int"], "NOT_FOUND");
    await fails(pg, a, NOW, "put_quran_progress", [18, 0], ["int", "int"], "VALIDATION_ERROR");
  });

  it("refuses an ayah past the end once the surah is imported", async () => {
    const a = await createUser(pg);
    await pg.query(
      "insert into public.quran_surahs (surah_number, arabic_name, latin_name, verse_count) values (112, 'x', 'Al-Ikhlas', 4)",
    );
    await fails(pg, a, NOW, "put_quran_progress", [112, 5], ["int", "int"], "VALIDATION_ERROR");
    expect(((await q(pg, a, NOW, "put_quran_progress", [112, 4], ["int", "int"])) as { ayah: number }).ayah).toBe(4);
  });
});

describe("access", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });
  afterAll(async () => pg.close());

  it.each([
    ["active", "active", "lifetime"],
    ["pending_verification", "awaiting_order_verification", null],
    ["suspended", "suspended", null],
    ["revoked", "suspended", null],
    ["expired", "none", null],
    ["none", "none", null],
  ] as const)("%s reads as %s", async (ent, status, type) => {
    const u = await createUser(pg, { entitlement: ent });
    const a = accessSchema.parse(await q(pg, u, NOW, "get_access"));
    expect(a).toMatchObject({ authenticated: true, access_status: status, entitlement_type: type });
    expect(a.onboarding_completed).toBe(status === "active");
  });

  it("onboarding_completed is false until it is done, even with access", async () => {
    const u = await createUser(pg, { onboarded: false });
    expect(((await q(pg, u, NOW, "get_access")) as { onboarding_completed: boolean }).onboarding_completed).toBe(false);
  });

  it("works for a user without an entitlement (it is the one private endpoint that does)", async () => {
    const u = await createUser(pg, { entitlement: "none" });
    const r = await as(pg, "authenticated", u, () => attempt(pg, "select public.get_access()"));
    expect(r.ok).toBe(true);
  });

  it("links a purchase made before the account existed, once the email is proven", async () => {
    await pg.query(
      "insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000aaaa', 'late@ngajigaes.test')",
    );
    await pg.query(
      "insert into public.access_entitlements (user_id, email_normalized, status, starts_at) values (null, 'late@ngajigaes.test', 'active', '2026-01-01T00:00:00Z')",
    );
    await pg.query("select app_private.provision_user($1::uuid, $2, $3::timestamptz)", [
      "00000000-0000-4000-8000-00000000aaaa",
      "late@ngajigaes.test",
      NOW,
    ]);
    expect(await q(pg, "00000000-0000-4000-8000-00000000aaaa", NOW, "get_access")).toMatchObject({
      access_status: "active",
    });
    // running it again changes nothing
    await pg.query("select app_private.provision_user($1::uuid, $2, $3::timestamptz)", [
      "00000000-0000-4000-8000-00000000aaaa",
      "late@ngajigaes.test",
      NOW,
    ]);
    expect(
      Number(
        (
          await rows<{ n: string }>(
            pg,
            "select count(*) as n from public.profiles where email_normalized = 'late@ngajigaes.test'",
          )
        )[0]!.n,
      ),
    ).toBe(1);
  });

  it("does not hand a purchase to someone with a different email", async () => {
    await pg.query(
      "insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000bbbb', 'other@ngajigaes.test')",
    );
    await pg.query(
      "insert into public.access_entitlements (user_id, email_normalized, status, starts_at) values (null, 'owner@ngajigaes.test', 'active', '2026-01-01T00:00:00Z')",
    );
    await pg.query("select app_private.provision_user($1::uuid, $2, $3::timestamptz)", [
      "00000000-0000-4000-8000-00000000bbbb",
      "other@ngajigaes.test",
      NOW,
    ]);
    expect(await q(pg, "00000000-0000-4000-8000-00000000bbbb", NOW, "get_access")).toMatchObject({
      access_status: "none",
    });
  });
});

describe("OTP codes and rate limits (AUTH-05, AUTH-06)", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });
  afterAll(async () => pg.close());

  const issue = async (email: string, code: string, now: string) =>
    (
      await rows<{ r: { ok: boolean; reason?: string; retry_after_seconds?: number } }>(
        pg,
        "select app_private.otp_issue($1, $2, $3::timestamptz) as r",
        [email, code, now],
      )
    )[0]!.r;
  const verify = async (email: string, code: string, now: string) =>
    (
      await rows<{ r: boolean }>(pg, "select app_private.otp_verify($1, $2, $3::timestamptz) as r", [email, code, now])
    )[0]!.r;
  const T0 = Date.parse("2026-11-12T10:00:00Z");
  const t = (secs: number) => new Date(T0 + secs * 1000).toISOString();

  it("a right code works once", async () => {
    await issue("e1", "h-right", t(0));
    expect(await verify("e1", "h-right", t(5))).toBe(true);
    expect(await verify("e1", "h-right", t(6))).toBe(false);
  });

  it("a wrong code costs an attempt, five kill the code even if the right one comes later", async () => {
    await issue("e2", "h-ok", t(0));
    for (let i = 0; i < 5; i++) expect(await verify("e2", "h-bad", t(1 + i))).toBe(false);
    expect(await verify("e2", "h-ok", t(10))).toBe(false);
  });

  it("the attempt count survives a failed check (it is not rolled back)", async () => {
    await issue("e3", "h-ok", t(0));
    await verify("e3", "h-bad", t(1));
    expect(
      (await rows<{ attempts: number }>(pg, "select attempts from public.login_otps where email_hash = 'e3'"))[0]!
        .attempts,
    ).toBe(1);
  });

  it("expires after 10 minutes", async () => {
    await issue("e4", "h-ok", t(0));
    expect(await verify("e4", "h-ok", t(601))).toBe(false);
    await issue("e5", "h-ok", t(0));
    expect(await verify("e5", "h-ok", t(599))).toBe(true);
  });

  it("an unknown email fails exactly like a wrong code", async () => {
    expect(await verify("nobody", "h-x", t(0))).toBe(false);
  });

  it("a new code replaces the old one and resets attempts", async () => {
    await issue("e6", "h-old", t(0));
    await verify("e6", "h-bad", t(1));
    await issue("e6", "h-new", t(100));
    expect(await verify("e6", "h-old", t(101))).toBe(false);
    expect(await verify("e6", "h-new", t(102))).toBe(true);
  });

  it("waits 60 seconds before another code, then allows 5 per hour per email", async () => {
    const first = await issue("e7", "h1", t(0));
    expect(first.ok).toBe(true);
    const wait = await issue("e7", "h2", t(30));
    expect(wait).toMatchObject({ ok: false, reason: "cooldown", retry_after_seconds: 30 });
    for (let i = 1; i < 5; i++) expect((await issue("e7", `h${i}`, t(i * 61))).ok).toBe(true);
    const sixth = await issue("e7", "h6", t(5 * 61));
    expect(sixth).toMatchObject({ ok: false, reason: "hourly_limit" });
    expect(sixth.retry_after_seconds).toBeGreaterThan(0);
  });

  it("rate_hit counts per key and window, and reports when to try again", async () => {
    const hit = async (key: string, secs: number) =>
      (
        await rows<{ r: { allowed: boolean; retry_after_seconds: number } }>(
          pg,
          "select app_private.rate_hit($1, $2::timestamptz, 3600, 10) as r",
          [key, t(secs)],
        )
      )[0]!.r;
    for (let i = 0; i < 10; i++) expect((await hit("ip:a", i)).allowed).toBe(true);
    const over = await hit("ip:a", 20);
    expect(over.allowed).toBe(false);
    expect(over.retry_after_seconds).toBeGreaterThan(0);
    expect((await hit("ip:b", 20)).allowed).toBe(true); // other key
    expect((await hit("ip:a", 3600 * 2)).allowed).toBe(true); // next window
  });

  it("the OTP and rate tables are closed to the browser roles", async () => {
    for (const table of ["login_otps", "rate_limits", "pending_logins", "device_sessions"]) {
      for (const role of ["authenticated", "anon"] as const) {
        const r = await as(pg, role, "00000000-0000-4000-8000-000000000001", () =>
          attempt(pg, `select * from public.${table}`),
        );
        expect(r, `${role} ${table}`).toMatchObject({ ok: false, error: { code: "42501" } });
      }
    }
  });
});

describe("devices, sessions and the 3 device limit (PRD §24.1)", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });
  afterAll(async () => pg.close());

  const start = async (uid: string, label: string, hash: string, now = NOW) =>
    (
      await rows<{ r: { status: string; device_id?: string; expires_at?: string; max_devices?: number } }>(
        pg,
        "select app_private.start_device_session($1::uuid, $2, $3, $4::timestamptz) as r",
        [uid, label, hash, now],
      )
    )[0]!.r;
  const resolve = async (device: string, hash: string, now: string) =>
    (
      await rows<{ r: { state: string; user_id?: string; expires_at?: string } }>(
        pg,
        "select app_private.resolve_session($1::uuid, $2, $3::timestamptz) as r",
        [device, hash, now],
      )
    )[0]!.r;

  it("signs in up to 3 devices and refuses the 4th without writing a row", async () => {
    const u = await createUser(pg);
    for (let i = 1; i <= 3; i++) expect((await start(u, `Perangkat ${i}`, `h${i}`)).status).toBe("ok");
    const fourth = await start(u, "Perangkat 4", "h4");
    expect(fourth).toMatchObject({ status: "device_limit", max_devices: 3 });
    expect(
      Number(
        (await rows<{ n: string }>(pg, "select count(*) as n from public.user_devices where user_id = $1", [u]))[0]!.n,
      ),
    ).toBe(3);
    expect(
      Number(
        (await rows<{ n: string }>(pg, "select count(*) as n from public.device_sessions where user_id = $1", [u]))[0]!
          .n,
      ),
    ).toBe(3);
  });

  it("the limit is per user", async () => {
    const a = await createUser(pg);
    const b = await createUser(pg);
    for (let i = 1; i <= 3; i++) await start(a, `A${i}`, `a${i}`);
    expect((await start(b, "B1", "b1")).status).toBe("ok");
  });

  it("a session is good for 30 days and reads as expired after that", async () => {
    const u = await createUser(pg);
    const s = await start(u, "HP", "hx", at(1));
    expect(await resolve(s.device_id!, "hx", at(20))).toMatchObject({ state: "ok", user_id: u });
    const far = "2027-02-01T00:00:00+07:00";
    expect((await resolve(s.device_id!, "hx", far)).state).toBe("expired");
  });

  it("is sliding: use extends it", async () => {
    const u = await createUser(pg);
    const s = await start(u, "HP", "hs", at(1));
    const r = await resolve(s.device_id!, "hs", "2026-11-25T00:00:00+07:00");
    expect(r.state).toBe("ok");
    expect(Date.parse(r.expires_at!)).toBeGreaterThan(Date.parse("2026-12-20T00:00:00Z"));
  });

  it("a wrong secret or an unknown device reads as no session, never as a different answer", async () => {
    const u = await createUser(pg);
    const s = await start(u, "HP", "hw");
    expect((await resolve(s.device_id!, "not-it", NOW)).state).toBe("none");
    expect((await resolve("00000000-0000-4000-8000-0000000000ee", "hw", NOW)).state).toBe("none");
  });

  it("lists devices newest use first and marks the current one", async () => {
    const u = await createUser(pg);
    const a = await start(u, "Tua", "l1", at(1));
    const b = await start(u, "Baru", "l2", at(2));
    const list = (
      await rows<{ r: { id: string; label: string; is_current: boolean }[] }>(
        pg,
        "select app_private.devices_json($1::uuid, $2::uuid) as r",
        [u, b.device_id],
      )
    )[0]!.r;
    expect(list.map((d) => d.label)).toEqual(["Baru", "Tua"]);
    expect(list.find((d) => d.id === b.device_id)!.is_current).toBe(true);
    expect(list.find((d) => d.id === a.device_id)!.is_current).toBe(false);
  });

  it("revokes another device at once: its cookie reads as revoked, and a slot opens", async () => {
    const u = await createUser(pg);
    const ids: string[] = [];
    for (let i = 1; i <= 3; i++) ids.push((await start(u, `D${i}`, `r${i}`)).device_id!);
    await pg.query("select app_private.revoke_device($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)", [
      u,
      ids[0],
      ids[2],
      NOW,
    ]);
    // the device_sessions row is gone, so the cookie no longer matches anything
    expect((await resolve(ids[2]!, "r3", NOW)).state).toBe("none");
    expect((await start(u, "D4", "r4")).status).toBe("ok");
  });

  it("cannot revoke the current device or someone else's device", async () => {
    const a = await createUser(pg);
    const b = await createUser(pg);
    const da = (await start(a, "A", "x1")).device_id!;
    const db = (await start(b, "B", "x2")).device_id!;
    const attemptRevoke = (uid: string, cur: string, target: string) =>
      attempt(pg, "select app_private.revoke_device($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)", [
        uid,
        cur,
        target,
        NOW,
      ]);
    expect(await attemptRevoke(a, da, da)).toMatchObject({ ok: false, error: { message: "VALIDATION_ERROR" } });
    expect(await attemptRevoke(a, da, db)).toMatchObject({ ok: false, error: { message: "NOT_FOUND" } });
    expect((await resolve(db, "x2", NOW)).state).toBe("ok");
  });

  it("logout ends this device only", async () => {
    const u = await createUser(pg);
    const a = (await start(u, "A", "o1")).device_id!;
    const b = (await start(u, "B", "o2")).device_id!;
    await pg.query("select app_private.logout_device($1::uuid, $2::uuid, $3::timestamptz)", [u, a, NOW]);
    expect((await resolve(a, "o1", NOW)).state).toBe("none");
    expect((await resolve(b, "o2", NOW)).state).toBe("ok");
  });

  describe("pending login (4th device)", () => {
    const pending = async (uid: string, hash: string, now = NOW) =>
      (
        await rows<{ r: { pending_expires_at: string; devices: { id: string }[] } }>(
          pg,
          "select app_private.create_pending_login($1::uuid, $2, $3::timestamptz) as r",
          [uid, hash, now],
        )
      )[0]!.r;
    const complete = (hash: string, device: string | null, now = NOW, session = "new-session") =>
      attempt<{ r: { status: string; device_id: string; user_id: string } }>(
        pg,
        "select app_private.complete_pending_login($1, $2::uuid, $3, $4, $5::timestamptz) as r",
        [hash, device, "Perangkat ke-4", session, now],
      );

    async function full() {
      const u = await createUser(pg);
      const ids: string[] = [];
      for (let i = 1; i <= 3; i++) ids.push((await start(u, `D${i}`, `p${i}-${u}`)).device_id!);
      return { u, ids };
    }

    it("lists the devices and lasts 10 minutes", async () => {
      const { u, ids } = await full();
      const p = await pending(u, "t-list");
      expect(p.devices.map((d) => d.id).sort()).toEqual([...ids].sort());
      expect(Date.parse(p.pending_expires_at) - Date.parse(NOW)).toBe(600_000);
    });

    it("removes the chosen device, signs the new one in, and works once", async () => {
      const { u, ids } = await full();
      await pending(u, "t-once");
      const r = await complete("t-once", ids[1]!);
      expect(r).toMatchObject({ ok: true });
      const res = (r as { ok: true; rows: { r: { status: string; device_id: string; user_id: string } }[] }).rows[0]!.r;
      expect(res).toMatchObject({ status: "ok", user_id: u });
      expect((await resolve(res.device_id, "new-session", NOW)).state).toBe("ok");
      expect((await resolve(ids[1]!, `p2-${u}`, NOW)).state).toBe("none");
      const again = await complete("t-once", ids[0]!);
      expect(again).toMatchObject({ ok: false, error: { message: "PENDING_LOGIN_INVALID" } });
      expect((await resolve(ids[0]!, `p1-${u}`, NOW)).state).toBe("ok"); // the second try removed nothing
    });

    it("never goes past 3 devices", async () => {
      const { u, ids } = await full();
      await pending(u, "t-cap");
      await complete("t-cap", ids[0]!);
      expect(
        Number(
          (
            await rows<{ n: string }>(
              pg,
              "select count(*) as n from public.user_devices where user_id = $1 and revoked_at is null",
              [u],
            )
          )[0]!.n,
        ),
      ).toBe(3);
    });

    it("expires after 10 minutes", async () => {
      const { u, ids } = await full();
      await pending(u, "t-exp");
      const late = new Date(Date.parse(NOW) + 601_000).toISOString();
      expect(await complete("t-exp", ids[0]!, late)).toMatchObject({
        ok: false,
        error: { message: "PENDING_LOGIN_INVALID" },
      });
      expect((await resolve(ids[0]!, `p1-${u}`, NOW)).state).toBe("ok");
    });

    it("an unknown token is the same refusal", async () => {
      const { ids } = await full();
      expect(await complete("t-none", ids[0]!)).toMatchObject({
        ok: false,
        error: { message: "PENDING_LOGIN_INVALID" },
      });
    });

    it("cannot remove a device that belongs to another user, and the token stays usable", async () => {
      const { u, ids } = await full();
      const other = await full();
      await pending(u, "t-cross");
      expect(await complete("t-cross", other.ids[0]!)).toMatchObject({ ok: false, error: { message: "NOT_FOUND" } });
      expect((await resolve(other.ids[0]!, `p1-${other.u}`, NOW)).state).toBe("ok");
      expect(await complete("t-cross", ids[2]!)).toMatchObject({ ok: true });
    });

    it("a newer permission replaces an older one for the same user", async () => {
      const { u, ids } = await full();
      await pending(u, "t-old");
      await pending(u, "t-new");
      expect(await complete("t-old", ids[0]!)).toMatchObject({
        ok: false,
        error: { message: "PENDING_LOGIN_INVALID" },
      });
      expect(await complete("t-new", ids[0]!)).toMatchObject({ ok: true });
    });
  });
});
