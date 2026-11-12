import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, applyStub, createTestDb, migrationFiles } from "../../scripts/db-lib";
import { as, attempt, rows } from "./harness";

const EXPECTED_TABLES = [
  // 17.1
  "profiles",
  "user_roles",
  "user_devices",
  "purchase_orders",
  "purchase_order_items",
  "access_entitlements",
  "webhook_events",
  // 17.2
  "levels",
  "activity_definitions",
  "level_activity_config",
  "content_versions",
  "user_level_state",
  "app_settings",
  // 17.3
  "night_sessions",
  "session_activities",
  "counter_operations",
  "session_audit_logs",
  "session_excuses",
  // 17.4
  "quran_sources",
  "quran_surahs",
  "quran_verses",
  "quran_translations",
  "quran_reading_progress",
  "session_quran_completions",
  // 17.5
  "notification_preferences",
  "push_subscriptions",
  "notification_templates",
  "notification_jobs",
  "notification_deliveries",
  // 17.6
  "regions",
  "prayer_times",
  // 17.7
  "jobs",
  "email_outbox",
  "rate_limits",
  "data_deletion_requests",
  "admin_audit_logs",
  // T3b (not in §17): per-date excuses, device cookies, OTP codes, pending 4th-device logins. All backend only.
  "device_sessions",
  "login_otps",
  "pending_logins",
];

/** Structure of the public schema as text, so two databases can be compared. */
async function shape(pg: PGlite): Promise<string> {
  const cols = await rows<{ c: string }>(
    pg,
    `select table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') as c
     from information_schema.columns where table_schema in ('public', 'app_private') order by 1`,
  );
  const cons = await rows<{ c: string }>(
    pg,
    `select conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) as c
     from pg_constraint where connamespace = 'public'::regnamespace order by 1`,
  );
  const idx = await rows<{ c: string }>(
    pg,
    "select indexname || ':' || indexdef as c from pg_indexes where schemaname = 'public' order by 1",
  );
  const pol = await rows<{ c: string }>(
    pg,
    "select tablename || ':' || policyname || ':' || cmd || ':' || coalesce(qual, '') as c from pg_policies where schemaname = 'public' order by 1",
  );
  const fn = await rows<{ c: string }>(
    pg,
    `select p.oid::regprocedure::text || ':' || md5(p.prosrc) as c from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace) order by 1`,
  );
  return [cols, cons, idx, pol, fn].map((x) => x.map((r) => r.c).join("\n")).join("\n--\n");
}

describe("migrations", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb({ seed: false });
  });
  afterAll(async () => pg.close());

  it("run in a fixed order with timestamp prefixes", () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect([...files].sort()).toEqual(files);
    for (const f of files) expect(f).toMatch(/^\d{14}_[a-z_]+\.sql$/);
  });

  it("create every table of PRD v1.2 §17", async () => {
    const t = await rows<{ tablename: string }>(
      pg,
      "select tablename from pg_tables where schemaname = 'public' order by 1",
    );
    expect(t.map((x) => x.tablename).sort()).toEqual([...EXPECTED_TABLES].sort());
  });

  it("can run a second time on the same database without changing anything", async () => {
    const before = await shape(pg);
    await applyMigrations(pg);
    expect(await shape(pg)).toBe(before);
  });

  it("give the same result from zero twice", async () => {
    const a = await createTestDb({ seed: false });
    const b = new PGlite();
    await applyStub(b);
    await applyMigrations(b);
    expect(await shape(b)).toBe(await shape(a));
    await a.close();
    await b.close();
  });

  it("have the unique constraints the PRD names", async () => {
    const defs = (
      await rows<{ d: string }>(
        pg,
        `select conrelid::regclass::text || ' ' || pg_get_constraintdef(oid) as d from pg_constraint
       where connamespace = 'public'::regnamespace and contype in ('u', 'p')`,
      )
    ).map((r) => r.d);
    const idx = (await rows<{ d: string }>(pg, "select indexdef as d from pg_indexes where schemaname = 'public'")).map(
      (r) => r.d,
    );
    const all = [...defs, ...idx].join("\n");
    for (const re of [
      /night_sessions UNIQUE \(user_id, fajr_local_date\)/,
      /counter_operations UNIQUE \(user_id, client_operation_id\)/,
      /webhook_events UNIQUE \(provider, external_event_id\)/,
      /prayer_times UNIQUE \(region_id, local_date, provider\)/,
      /access_entitlements UNIQUE \(purchase_order_id, entitlement_type\)/,
      /notification_jobs UNIQUE \(dedupe_key\)/,
      /profiles UNIQUE \(email_normalized\)/,
      /user_roles PRIMARY KEY \(user_id, role\)/,
      /levels UNIQUE \(level_number\)/,
      /activity_definitions UNIQUE \(activity_key\)/,
      /push_subscriptions UNIQUE \(endpoint\)/,
      /purchase_orders UNIQUE \(scalev_order_id\)/,
      /rate_limits PRIMARY KEY \(key, window_start\)/,
    ]) {
      expect(all).toMatch(re);
    }
  });

  it("have indexes for the dashboard, calendar, and job queue queries", async () => {
    const idx = (
      await rows<{ n: string }>(pg, "select indexname as n from pg_indexes where schemaname = 'public'")
    ).map((r) => r.n);
    for (const n of [
      "night_sessions_user_status_idx",
      "session_activities_user_idx",
      "counter_operations_activity_idx",
      "jobs_queue_idx",
      "notification_jobs_due_idx",
      "access_entitlements_email_idx",
      "user_devices_active_idx",
    ]) {
      expect(idx).toContain(n);
    }
  });

  it("reject bad values at the table level", async () => {
    const bad = [
      "insert into public.levels (level_number, title, required_successful_nights) values (4, 'x', 1)",
      "insert into public.regions (province_name, city_name, timezone) values ('a', 'b', 'Europe/London')",
      "insert into public.content_versions (content_type, content_id, version_number, snapshot_json, submitted_by, reviewer_id) values ('level', gen_random_uuid(), 1, '{}', gen_random_uuid(), null) returning id",
    ];
    expect((await attempt(pg, bad[0]!)).ok).toBe(false);
    expect((await attempt(pg, bad[1]!)).ok).toBe(false);
    // reviewer must differ from submitter: same user on both is refused
    const u = "00000000-0000-4000-8000-0000000000aa";
    await pg.query("insert into auth.users (id, email) values ($1, 'cv@ngajigaes.test')", [u]);
    const same = await attempt(
      pg,
      "insert into public.content_versions (content_type, content_id, version_number, snapshot_json, submitted_by, reviewer_id) values ('level', gen_random_uuid(), 1, '{}', $1, $1)",
      [u],
    );
    expect(same.ok).toBe(false);
  });
});

describe("security shape (PRD §18, SEC-03)", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });
  afterAll(async () => pg.close());

  it("RLS is on for every table", async () => {
    const off = await rows<{ relname: string }>(
      pg,
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(off).toEqual([]);
  });

  it("authenticated and anon hold no INSERT, UPDATE, DELETE or TRUNCATE on any table or column", async () => {
    const tbl = await rows<{ t: string }>(
      pg,
      `select table_name || ':' || grantee || ':' || privilege_type as t from information_schema.role_table_grants
       where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
         and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')`,
    );
    expect(tbl).toEqual([]);
    const col = await rows<{ t: string }>(
      pg,
      `select table_name || '.' || column_name || ':' || grantee || ':' || privilege_type as t
       from information_schema.column_privileges
       where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE')`,
    );
    expect(col).toEqual([]);
  });

  it("anon can read nothing at all", async () => {
    const t = await rows<{ t: string }>(
      pg,
      "select table_name as t from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'",
    );
    expect(t).toEqual([]);
  });

  it("tables created later stay closed by default", async () => {
    await pg.exec(
      "create table public.zz_future (id int); create function public.zz_fn() returns int language sql as 'select 1';",
    );
    const g = await rows<{ t: string }>(
      pg,
      `select grantee as t from information_schema.role_table_grants where table_name = 'zz_future' and grantee in ('anon', 'authenticated')`,
    );
    expect(g).toEqual([]);
    const f = await attempt(pg, "select public.zz_fn()");
    expect(f.ok).toBe(true); // postgres can
    const asUser = await as(pg, "authenticated", "00000000-0000-4000-8000-000000000001", () =>
      attempt(pg, "select public.zz_fn()"),
    );
    expect(asUser).toMatchObject({ ok: false, error: { code: "42501" } });
    await pg.exec("drop table public.zz_future; drop function public.zz_fn();");
  });

  it("every SECURITY DEFINER function locks its search_path", async () => {
    const r = await rows<{ fn: string; cfg: string[] | null }>(
      pg,
      `select p.oid::regprocedure::text as fn, p.proconfig as cfg from pg_proc p
       where p.prosecdef and p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace)`,
    );
    expect(r.length).toBeGreaterThanOrEqual(4);
    for (const f of r) expect((f.cfg ?? []).join(","), f.fn).toMatch(/search_path=("")?$|search_path=""/);
  });

  it("only the listed RPCs are executable by authenticated, none by anon or PUBLIC", async () => {
    const r = await rows<{ fn: string; role: string }>(
      pg,
      `select p.oid::regprocedure::text as fn, r.rolname as role
       from pg_proc p cross join pg_roles r
       where p.pronamespace in ('public'::regnamespace, 'app_private'::regnamespace)
         and r.rolname in ('anon', 'authenticated')
         and has_function_privilege(r.rolname, p.oid, 'EXECUTE')`,
    );
    const authed = r
      .filter((x) => x.role === "authenticated")
      .map((x) => x.fn)
      .sort();
    // The complete list of what a signed-in browser role may call. A new RPC must be added here on purpose.
    expect(authed).toEqual(
      [
        "apply_counter_operation(uuid,text,text,integer,timestamp with time zone)",
        "ensure_active_session()",
        "has_active_entitlement(uuid)",
        "set_checklist(uuid,boolean,integer)",
        "add_excuse(date,date)",
        "add_push_subscription(uuid,text,text,text)",
        "cancel_excuse(date)",
        "complete_onboarding()",
        "get_access()",
        "get_active_session()",
        "get_activity_stats()",
        "get_calendar(date,date)",
        "get_current_level()",
        "get_dashboard()",
        "get_level_progress()",
        "get_night_session(uuid)",
        "get_notification_prefs()",
        "get_prayer_row(date)",
        "get_prayer_times(uuid,date,date,boolean)",
        "get_profile()",
        "get_quran_progress()",
        "get_report(integer)",
        "get_session_history()",
        "get_session_summary(uuid)",
        "list_notifications(integer)",
        "list_regions()",
        "remove_push_subscription(uuid)",
        "put_notification_prefs(jsonb)",
        "put_quran_progress(integer,integer)",
        "set_location(text,uuid,text,text,text)",
        "update_preferences(text,integer,integer)",
        "update_profile(text)",
      ].sort(),
    );
    expect(r.filter((x) => x.role === "anon")).toEqual([]);
  });

  it("authenticated cannot see the private schema", async () => {
    const r = await as(pg, "authenticated", "00000000-0000-4000-8000-000000000001", () =>
      attempt(pg, "select app_private.setting('cutoff_local_time')"),
    );
    expect(r).toMatchObject({ ok: false, error: { code: "42501" } });
  });
});
