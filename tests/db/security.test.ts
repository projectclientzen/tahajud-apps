import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, attempt, createTestDb, createUser, rows, startSession, activityId, applyOp } from "./harness";

const NOW = "2026-11-12T02:00:00+07:00"; // before the 12.00 cutoff: session key 2026-11-12

describe("row level security", () => {
  let pg: PGlite;
  let a: string;
  let b: string;
  let sessA: { session_id: string };
  let sessB: { session_id: string };
  let actA: string;
  let actB: string;

  beforeAll(async () => {
    pg = await createTestDb();
    a = await createUser(pg);
    b = await createUser(pg);
    sessA = await startSession(pg, a, NOW);
    sessB = await startSession(pg, b, NOW);
    actA = await activityId(pg, sessA.session_id, "istighfar");
    actB = await activityId(pg, sessB.session_id, "istighfar");
    await applyOp(pg, a, NOW, actA, "a-1", "delta", 10);
    await applyOp(pg, b, NOW, actB, "b-1", "delta", 20);
    await pg.query(
      "insert into public.quran_reading_progress (user_id, surah_number, last_verse) values ($1, 18, 5), ($2, 36, 7)",
      [a, b],
    );
    await pg.query("insert into public.notification_preferences (user_id) values ($1), ($2)", [a, b]);
    await pg.query(
      "insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/a', 'KEY-A', 'AUTH-A'), ($2, 'https://push.example/b', 'KEY-B', 'AUTH-B')",
      [a, b],
    );
  });
  afterAll(async () => pg.close());

  const OWN_TABLES = [
    ["profiles", "user_id"],
    ["night_sessions", "user_id"],
    ["session_activities", "user_id"],
    ["counter_operations", "user_id"],
    ["user_level_state", "user_id"],
    ["quran_reading_progress", "user_id"],
    ["notification_preferences", "user_id"],
    ["access_entitlements", "user_id"],
  ] as const;

  describe("SECURITY-01 a user cannot read another user's data", () => {
    it.each(OWN_TABLES)("%s: user A sees only their own rows", async (table, col) => {
      const seen = await as(pg, "authenticated", a, async () =>
        rows<{ u: string }>(pg, `select ${col}::text as u from public.${table}`),
      );
      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen.map((r) => r.u))).toEqual(new Set([a]));
    });

    it("asking for B's session by id returns nothing", async () => {
      const r = await as(pg, "authenticated", a, () =>
        rows(pg, "select * from public.night_sessions where id = $1", [sessB.session_id]),
      );
      expect(r).toEqual([]);
      const acts = await as(pg, "authenticated", a, () =>
        rows(pg, "select * from public.session_activities where session_id = $1", [sessB.session_id]),
      );
      expect(acts).toEqual([]);
    });

    it("counter operations of B stay hidden, including their operation ids", async () => {
      const r = await as(pg, "authenticated", a, () =>
        rows<{ client_operation_id: string }>(pg, "select client_operation_id from public.counter_operations"),
      );
      expect(r.map((x) => x.client_operation_id)).toEqual(["a-1"]);
    });

    it("a user without a session claim sees nothing", async () => {
      const r = await as(pg, "authenticated", null, () => rows(pg, "select * from public.night_sessions"));
      expect(r).toEqual([]);
    });

    it("A cannot act on B's activity: the answer looks like 'not found'", async () => {
      const r = await as(pg, "authenticated", a, () =>
        attempt<{ r: { status: string; error_code: string } }>(
          pg,
          "select public.apply_counter_operation($1, 'steal-1', 'delta', 5, null) as r",
          [actB],
        ),
      );
      expect(r.ok && r.rows[0]!.r).toMatchObject({ status: "rejected", error_code: "ACTIVITY_NOT_FOUND" });
      const check = await as(pg, "authenticated", a, () =>
        attempt(pg, "select public.set_checklist($1, true, 0)", [actB]),
      );
      expect(check).toMatchObject({ ok: false, error: { message: "NOT_FOUND" } });
      expect(
        (
          await rows<{ c: number }>(pg, "select actual_count as c from public.session_activities where id = $1", [actB])
        )[0]!.c,
      ).toBe(20);
    });

    it("push subscription keys and endpoints are never readable by the user", async () => {
      const ok = await as(pg, "authenticated", a, () =>
        rows<{ id: string; is_active: boolean }>(pg, "select id, is_active from public.push_subscriptions"),
      );
      expect(ok).toHaveLength(1);
      for (const col of ["p256dh", "auth", "endpoint"]) {
        const r = await as(pg, "authenticated", a, () => attempt(pg, `select ${col} from public.push_subscriptions`));
        expect(r, col).toMatchObject({ ok: false, error: { code: "42501" } });
      }
      const star = await as(pg, "authenticated", a, () => attempt(pg, "select * from public.push_subscriptions"));
      expect(star).toMatchObject({ ok: false, error: { code: "42501" } });
    });

    it("entitlement columns that matter to billing are not readable", async () => {
      const ok = await as(pg, "authenticated", a, () =>
        rows<{ status: string }>(pg, "select status from public.access_entitlements"),
      );
      expect(ok).toEqual([{ status: "active" }]);
      for (const col of ["email_normalized", "revoke_reason", "transferred_from_email", "purchase_order_id"]) {
        const r = await as(pg, "authenticated", a, () => attempt(pg, `select ${col} from public.access_entitlements`));
        expect(r, col).toMatchObject({ ok: false, error: { code: "42501" } });
      }
    });
  });

  describe("SECURITY-03 a user cannot write tracking tables directly", () => {
    it("UPDATE night_sessions.status is refused and the status does not change", async () => {
      const before = (
        await rows<{ status: string }>(pg, "select status from public.night_sessions where id = $1", [sessA.session_id])
      )[0]!.status;
      const r = await as(pg, "authenticated", a, () =>
        attempt(pg, "update public.night_sessions set status = 'completed' where id = $1", [sessA.session_id]),
      );
      expect(r).toMatchObject({ ok: false, error: { code: "42501" } });
      expect(
        (
          await rows<{ status: string }>(pg, "select status from public.night_sessions where id = $1", [
            sessA.session_id,
          ])
        )[0]!.status,
      ).toBe(before);
    });

    it.each([
      ["update night_sessions", "update public.night_sessions set level_number = 3"],
      ["delete night_sessions", "delete from public.night_sessions"],
      ["update session_activities", "update public.session_activities set actual_count = 9999, status = 'done'"],
      [
        "insert session_activities",
        "insert into public.session_activities (session_id, user_id, activity_definition_id, activity_config_snapshot, phase, required_for_completion) select session_id, user_id, activity_definition_id, '{}', 'night', true from public.session_activities limit 1",
      ],
      [
        "insert counter_operations",
        "insert into public.counter_operations (user_id, client_operation_id, session_activity_id, op_type, resulting_count) select user_id, 'forged', id, 'delta', 99999 from public.session_activities limit 1",
      ],
      ["update counter_operations", "update public.counter_operations set resulting_count = 0"],
      ["update user_level_state", "update public.user_level_state set current_level = 3, level_3_unlocked_at = now()"],
      [
        "insert user_level_state",
        "insert into public.user_level_state (user_id, current_level) values (gen_random_uuid(), 3)",
      ],
      ["update profiles", "update public.profiles set onboarding_completed = true, program_start_date = '2020-01-01'"],
      ["update access_entitlements", "update public.access_entitlements set status = 'active', expires_at = null"],
      [
        "insert access_entitlements",
        "insert into public.access_entitlements (email_normalized, status) values ('x@y.test', 'active')",
      ],
      [
        "insert quran_reading_progress",
        "insert into public.quran_reading_progress (user_id, surah_number) values (gen_random_uuid(), 1)",
      ],
      ["update notification_preferences", "update public.notification_preferences set bedtime_enabled = false"],
      ["truncate night_sessions", "truncate public.night_sessions"],
    ])("%s is refused", async (_name, sql) => {
      const r = await as(pg, "authenticated", a, () => attempt(pg, sql));
      expect(r).toMatchObject({ ok: false, error: { code: "42501" } });
    });

    it("none of the refused statements changed data", async () => {
      const r = await rows<{ c: number; s: string }>(
        pg,
        "select actual_count as c, status as s from public.session_activities where id = $1",
        [actA],
      );
      expect(r[0]).toMatchObject({ c: 10, s: "in_progress" });
      expect((await rows<{ n: string }>(pg, "select count(*)::text as n from public.night_sessions"))[0]!.n).toBe("2");
    });

    it("the service role can write (the backend path) and anon cannot", async () => {
      const w = await as(pg, "service_role", null, () =>
        attempt(pg, "insert into public.rate_limits (key, window_start, count) values ('otp:test', now(), 1)"),
      );
      expect(w.ok).toBe(true);
      const anon = await as(pg, "anon", null, () => attempt(pg, "select * from public.night_sessions"));
      expect(anon).toMatchObject({ ok: false, error: { code: "42501" } });
    });
  });

  describe("backend-only tables (PRD §18.3)", () => {
    it.each([
      "webhook_events",
      "purchase_orders",
      "purchase_order_items",
      "user_roles",
      "app_settings",
      "content_versions",
      "session_audit_logs",
      "quran_translations",
      "notification_templates",
      "notification_jobs",
      "notification_deliveries",
      "jobs",
      "email_outbox",
      "rate_limits",
      "data_deletion_requests",
      "admin_audit_logs",
    ])("%s cannot be read or written by a signed-in user", async (table) => {
      const read = await as(pg, "authenticated", a, () => attempt(pg, `select * from public.${table}`));
      expect(read, `${table} select`).toMatchObject({ ok: false, error: { code: "42501" } });
      const del = await as(pg, "authenticated", a, () => attempt(pg, `delete from public.${table}`));
      expect(del, `${table} delete`).toMatchObject({ ok: false, error: { code: "42501" } });
    });
  });

  describe("SECURITY-02 without an active entitlement the mutation functions refuse", () => {
    const states = ["none", "pending_verification", "suspended", "revoked", "expired"] as const;

    it.each(states)(
      "entitlement %s: all three mutations raise ENTITLEMENT_INACTIVE and old data stays",
      async (state) => {
        const u = await createUser(pg, { entitlement: "active" });
        const s = await startSession(pg, u, NOW);
        const act = await activityId(pg, s.session_id, "istighfar");
        const check = await activityId(pg, s.session_id, "doa");
        await applyOp(pg, u, NOW, act, `keep-${state}`, "delta", 7);

        // lose access
        if (state === "none") await pg.query("delete from public.access_entitlements where user_id = $1", [u]);
        else if (state === "expired")
          await pg.query(
            "update public.access_entitlements set status = 'active', expires_at = '2026-01-01' where user_id = $1",
            [u],
          );
        else await pg.query("update public.access_entitlements set status = $2 where user_id = $1", [u, state]);

        const calls = [
          "select public.ensure_active_session()",
          `select public.set_checklist('${check}', true, 0)`,
          `select public.apply_counter_operation('${act}', 'after-${state}', 'delta', 5, null)`,
        ];
        for (const sql of calls) {
          const r = await as(pg, "authenticated", u, () => attempt(pg, sql));
          expect(r, sql).toMatchObject({ ok: false, error: { message: "ENTITLEMENT_INACTIVE" } });
        }
        // nothing was written, and the earlier record is still there
        const kept = await rows<{ c: number; ops: string }>(
          pg,
          "select a.actual_count as c, (select count(*)::text from public.counter_operations o where o.user_id = a.user_id) as ops from public.session_activities a where a.id = $1",
          [act],
        );
        expect(kept[0]).toMatchObject({ c: 7, ops: "1" });
        // and the user can still read their own history
        const own = await as(pg, "authenticated", u, () => rows(pg, "select * from public.night_sessions"));
        expect(own).toHaveLength(1);
      },
    );

    it("paid content is hidden too: levels, activity text, regions", async () => {
      const u = await createUser(pg, { entitlement: "suspended" });
      for (const t of ["levels", "activity_definitions", "level_activity_config", "regions", "quran_verses"]) {
        const r = await as(pg, "authenticated", u, () => rows(pg, `select * from public.${t}`));
        expect(r, t).toEqual([]);
      }
      const active = await as(pg, "authenticated", a, () => rows(pg, "select * from public.levels"));
      expect(active).toHaveLength(3);
      const text = await as(pg, "authenticated", a, () =>
        rows<{ arabic_text: string }>(
          pg,
          "select arabic_text from public.activity_definitions where arabic_text is not null limit 1",
        ),
      );
      expect(text[0]!.arabic_text.length).toBeGreaterThan(5);
    });

    it("has_active_entitlement only answers for the caller", async () => {
      const mine = await as(pg, "authenticated", a, () =>
        rows<{ v: boolean }>(pg, "select public.has_active_entitlement($1) as v", [a]),
      );
      const other = await as(pg, "authenticated", a, () =>
        rows<{ v: boolean }>(pg, "select public.has_active_entitlement($1) as v", [b]),
      );
      const anon = await as(pg, "authenticated", null, () =>
        rows<{ v: boolean }>(pg, "select public.has_active_entitlement($1) as v", [a]),
      );
      expect([mine[0]!.v, other[0]!.v, anon[0]!.v]).toEqual([true, false, false]);
    });

    it("anon cannot call any RPC", async () => {
      for (const sql of [
        "select public.ensure_active_session()",
        "select public.has_active_entitlement(gen_random_uuid())",
      ]) {
        const r = await as(pg, "anon", null, () => attempt(pg, sql));
        expect(r, sql).toMatchObject({ ok: false, error: { code: "42501" } });
      }
    });

    it("a signed-in call without a user id is UNAUTHENTICATED", async () => {
      const r = await as(pg, "authenticated", null, () => attempt(pg, "select public.ensure_active_session()"));
      expect(r).toMatchObject({ ok: false, error: { message: "UNAUTHENTICATED" } });
    });
  });
});
