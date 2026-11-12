import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCalendar, type SessionRecord } from "@/domain/calendar/calendar";
import { activityStats, completionRate, selectPeriod, statusCounts } from "@/domain/reporting/reports";
import {
  activityStatSchema,
  calendarResponseSchema,
  levelProgressResponseSchema,
  nightSessionSchema,
  reportResponseSchema,
  sessionHistoryResponseSchema,
  sessionSummarySchema,
} from "@/data/contracts";
import { getAmalan } from "@/domain/content/amalan";
import {
  activityId,
  applyOp,
  as,
  attempt,
  completeSession,
  createTestDb,
  createUser,
  rows,
  startSession,
} from "./harness";

const day = (n: number) => `2026-11-${String(n).padStart(2, "0")}`;
const at = (n: number, time = "02:00") => `${day(n)}T${time}:00+07:00`;
const NOW = at(12);

/** Run an app_private function with (uid, now, ...args). Parameters after `now` are passed through as text. */
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

describe("read functions for /api/v1", () => {
  let pg: PGlite;
  let uid: string;
  let other: string;

  beforeAll(async () => {
    pg = await createTestDb();
    uid = await createUser(pg);
    other = await createUser(pg);
    // 11-02 completed, 11-03 completed, 11-04 partial, 11-05 no row (missed), 11-06 excused with row, 11-07 completed.
    for (const n of [2, 3, 7]) {
      const s = await startSession(pg, uid, at(n));
      await completeSession(pg, uid, s.session_id, at(n));
    }
    const s4 = await startSession(pg, uid, at(4));
    await applyOp(pg, uid, at(4), await activityId(pg, s4.session_id, "istighfar"), "p-1", "delta", 40);
    const s6 = await startSession(pg, uid, at(6));
    await applyOp(pg, uid, at(6), await activityId(pg, s6.session_id, "shalawat"), "p-2", "delta", 10);
    await q(pg, uid, at(6), "add_excuse", [day(6), null], ["date", "date"]);
    // 11-09 excused with no row at all
    await q(pg, uid, at(9), "add_excuse", [day(9), null], ["date", "date"]);
    // today: a session with partial progress, still open
    const s12 = await startSession(pg, uid, NOW);
    await applyOp(pg, uid, NOW, await activityId(pg, s12.session_id, "istighfar"), "p-3", "delta", 5);
    // another user's data must never leak
    const so = await startSession(pg, other, at(8));
    await completeSession(pg, other, so.session_id, at(8));
  });
  afterAll(async () => pg.close());

  describe("calendar, reports and progress match src/domain", () => {
    async function domainView() {
      const sessions = await rows<{ id: string; fajr_local_date: string; level_number: number }>(
        pg,
        "select id, to_char(fajr_local_date, 'YYYY-MM-DD') as fajr_local_date, level_number from public.night_sessions where user_id = $1",
        [uid],
      );
      const records: SessionRecord[] = [];
      for (const s of sessions) {
        const acts = await rows<{
          phase: string;
          key: string;
          kind: "counter" | "checklist";
          required_for_completion: boolean;
          target_count: number | null;
          actual_count: number;
          status: string;
        }>(
          pg,
          `select phase, activity_config_snapshot ->> 'activity_key' as key, activity_config_snapshot ->> 'kind' as kind,
                  required_for_completion, target_count, actual_count, status
           from public.session_activities where session_id = $1`,
          [s.id],
        );
        records.push({
          sessionKey: s.fajr_local_date,
          level: s.level_number as 1 | 2 | 3,
          activities: acts.map((a) => ({
            id: `${a.phase}:${a.key}`,
            kind: a.kind,
            required: a.required_for_completion,
            target: a.target_count,
            count: a.actual_count,
            checked: a.kind === "checklist" && a.status === "done",
          })),
        });
      }
      const excused = (
        await rows<{ d: string }>(
          pg,
          "select to_char(excused_date, 'YYYY-MM-DD') as d from public.session_excuses where user_id = $1",
          [uid],
        )
      ).map((r) => r.d);
      const days = buildCalendar({ programStartDate: day(1), activeKey: day(12), records, excusedDates: excused });
      return { records, days };
    }

    it("calendar days equal buildCalendar, including derived missed and excused without a row", async () => {
      const { days } = await domainView();
      const json = calendarResponseSchema.parse(await q(pg, uid, NOW, "calendar_json", [null, null], ["date", "date"]));
      expect(json.days).toEqual(
        days.map((d) => ({ date: d.date, status: d.status, level: d.level, has_progress: d.hasProgress })),
      );
      const byDate = Object.fromEntries(json.days.map((d) => [d.date, d.status]));
      expect(byDate[day(1)]).toBe("missed"); // no row, closed
      expect(byDate[day(2)]).toBe("completed");
      expect(byDate[day(4)]).toBe("partial");
      expect(byDate[day(5)]).toBe("missed");
      expect(byDate[day(6)]).toBe("excused"); // had progress, excused wins
      expect(byDate[day(9)]).toBe("excused"); // no row
      expect(byDate[day(12)]).toBe("upcoming");
    });

    it("a date range clamps to the program start and the active session", async () => {
      const r = calendarResponseSchema.parse(
        await q(pg, uid, NOW, "calendar_json", [day(5), day(7)], ["date", "date"]),
      );
      expect(r.days.map((d) => d.date)).toEqual([day(5), day(6), day(7)]);
      const wide = calendarResponseSchema.parse(
        await q(pg, uid, NOW, "calendar_json", ["2020-01-01", "2030-01-01"], ["date", "date"]),
      );
      expect(wide.days[0]!.date).toBe(day(1));
      expect(wide.days.at(-1)!.date).toBe(day(12));
    });

    it("status counts and completion rate equal the domain", async () => {
      const { days } = await domainView();
      const counts = await q<Record<string, number>>(
        pg,
        uid,
        NOW,
        "status_counts_json",
        [null, null],
        ["date", "date"],
      );
      expect(counts).toEqual(statusCounts(days));
      const rate = await rows<{ r: string | null }>(pg, "select app_private.completion_rate($1::jsonb)::text as r", [
        JSON.stringify(counts),
      ]);
      expect(rate[0]!.r === null ? null : Number(rate[0]!.r)).toBe(completionRate(days));
    });

    it.each([7, 30, 90] as const)("report for %i days equals selectPeriod + domain stats", async (period) => {
      const { days, records } = await domainView();
      const sel = selectPeriod(days, period, day(1), day(12));
      const rep = reportResponseSchema
        .omit({ insight: true })
        .parse(await q(pg, uid, NOW, "report_json", [period], ["int"]));
      expect(rep.status_counts).toEqual(statusCounts(sel));
      expect(rep.completion_rate).toBe(completionRate(sel));
      expect(rep.from).toBe(sel[0]?.date ?? null);
      expect(rep.to).toBe(sel.at(-1)?.date ?? null);
      const inRange = new Set(sel.map((d) => d.date));
      const expected = activityStats(records.filter((r) => inRange.has(r.sessionKey))).map((s) => ({
        id: s.id,
        key: s.key,
        phase: s.phase,
        sessions: s.sessions,
        with_progress: s.withProgress,
        times_completed: s.timesCompleted,
        total_count: s.totalCount,
      }));
      expect(rep.activity_statistics).toEqual(expected);
    });

    it("the 7 day report never reaches before the program start and excludes the active session", async () => {
      const rep = reportResponseSchema
        .omit({ insight: true })
        .parse(await q(pg, uid, NOW, "report_json", [7], ["int"]));
      expect(rep.to).toBe(day(11));
      expect(rep.from).toBe(day(5));
      expect(rep.status_counts.upcoming).toBe(0);
    });

    it("rejects any other period", async () => {
      const r = await attempt(pg, "select app_private.report_json($1::uuid, $2::timestamptz, 14)", [uid, NOW]);
      expect(r).toMatchObject({ ok: false, error: { message: "VALIDATION_ERROR" } });
    });

    it("activity statistics cover all sessions and count excused ones too (PRD §10.6)", async () => {
      const { records } = await domainView();
      const out = (await q<{ activity_statistics: unknown[] }>(pg, uid, NOW, "get_activity_stats")).activity_statistics;
      for (const s of out) activityStatSchema.parse(s);
      const expected = activityStats(records);
      expect(out).toHaveLength(expected.length);
      const ist = out.find((s) => (s as { id: string }).id === "night:istighfar") as { total_count: number };
      expect(ist.total_count).toBe(expected.find((s) => s.id === "night:istighfar")!.totalCount);
    });

    it("level progress counts only completed sessions and never lowers", async () => {
      const lp = levelProgressResponseSchema.parse(await q(pg, uid, NOW, "level_progress_json"));
      expect(lp.current_level).toBe(1);
      expect(lp.levels[0]).toMatchObject({ level: 1, completed: 3, required: 7, unlocked: true, is_current: true });
      expect(lp.levels[0]!.ratio).toBeCloseTo(3 / 7, 10);
      expect(lp.levels[1]).toMatchObject({ unlocked: false, effective_from_session_key: null });
      expect(lp.journey_completed).toBe(false);
      expect(lp.provisional).toBe(true);
    });

    it("session history lists sessions with a row, newest first", async () => {
      const h = sessionHistoryResponseSchema.parse(await q(pg, uid, NOW, "session_history_json"));
      expect(h.sessions.map((s) => s.session_key)).toEqual([day(12), day(7), day(6), day(4), day(3), day(2)]);
      const total = getAmalan().levels[1].activities.filter((a) => a.required).length;
      expect(h.sessions[1]).toMatchObject({
        status: "completed",
        level: 1,
        required_total: total,
        required_done: total,
      });
      expect(h.sessions.find((s) => s.session_key === day(6))!.status).toBe("excused");
    });
  });

  describe("dashboard", () => {
    it("holds the pieces the database owns, in the contract shape", async () => {
      const d = await q<Record<string, unknown>>(pg, uid, NOW, "dashboard_json");
      expect(d).toMatchObject({
        is_demo: false,
        level: 1,
        completion_rate: 33.33,
        status_counts: { completed: 3, partial: 1, missed: 5, excused: 2, upcoming: 1 },
      });
      expect((d.calendar_days as unknown[]).length).toBe(12);
      expect(d.current_session).toMatchObject({ session_key: day(12), status: "upcoming", state: "in_progress" });
      const cards = d.setup_cards as { key: string; done: boolean }[];
      expect(cards).toEqual([
        { key: "location", done: true },
        { key: "notifications", done: false },
      ]);
    });

    it("keeps only the last 30 calendar days", async () => {
      const u = await createUser(pg);
      await pg.query("update public.profiles set program_start_date = '2026-09-01' where user_id = $1", [u]);
      const d = await q<{ calendar_days: { date: string }[] }>(pg, u, NOW, "dashboard_json");
      expect(d.calendar_days).toHaveLength(30);
      expect(d.calendar_days.at(-1)!.date).toBe(day(12));
    });

    it("shows the required total of the level before any session row exists", async () => {
      const u = await createUser(pg);
      const d = await q<{ current_session: { id: string | null; required_total: number; required_done: number } }>(
        pg,
        u,
        NOW,
        "dashboard_json",
      );
      expect(d.current_session.id).toBeNull();
      expect(d.current_session.required_done).toBe(0);
      expect(d.current_session.required_total).toBeGreaterThan(0);
    });

    it("has an empty calendar and a null completion rate before onboarding", async () => {
      const u = await createUser(pg, { onboarded: false });
      await pg.query("update public.profiles set program_start_date = null where user_id = $1", [u]);
      const d = await q<{ calendar_days: unknown[]; completion_rate: number | null }>(pg, u, NOW, "dashboard_json");
      expect(d.calendar_days).toEqual([]);
      expect(d.completion_rate).toBeNull();
    });
  });

  describe("session views", () => {
    it("shows today's session in the NightSession shape with the owner's Arabic text unchanged", async () => {
      const j = await q<{ activities: { key: string; arabic_text: string | null; phase: string }[] }>(
        pg,
        uid,
        NOW,
        "active_session_json",
      );
      const s = nightSessionSchema.parse(j);
      expect(s.session_key).toBe(day(12));
      expect(s.state).toBe("in_progress");
      expect(s.status).toBe("upcoming");
      expect(s.correction_window_open).toBe(true);
      const owner = getAmalan();
      for (const a of s.activities.filter((x) => x.kind === "counter")) {
        const cfg = owner.levels[1].activities.find((c) => c.key === a.key && c.phase === a.phase)!;
        expect(a.arabic_text).toBe(owner.dhikr[cfg.dhikrRef!]!.arabicText);
        expect(a.dhikr_review_status).toBe("published");
      }
      for (const a of s.activities.filter((x) => x.kind === "checklist")) expect(a.arabic_text).toBeNull();
      const order = s.activities.map((a) => a.phase);
      expect(order).toEqual(
        [...order].sort(
          (x, y) => ["night", "fajr", "post_fajr"].indexOf(x) - ["night", "fajr", "post_fajr"].indexOf(y),
        ),
      );
      const ist = s.activities.find((a) => a.key === "istighfar" && a.phase === "night")!;
      expect(ist).toMatchObject({ count: 5, target: 100, completed: false, unit: "kali" });
    });

    it("returns null when nothing exists yet and the session by id after it does", async () => {
      const u = await createUser(pg);
      expect(await q(pg, u, NOW, "active_session_json")).toBeNull();
      const s = await startSession(pg, u, NOW);
      const byId = nightSessionSchema.parse(await q(pg, u, NOW, "get_session_json", [s.session_id], ["uuid"]));
      expect(byId.id).toBe(s.session_id);
    });

    it("another user's session reads as NOT_FOUND, never as forbidden", async () => {
      const mine = await rows<{ id: string }>(pg, "select id from public.night_sessions where user_id = $1 limit 1", [
        uid,
      ]);
      const r = await attempt(pg, "select app_private.get_session_json($1::uuid, $2::timestamptz, $3::uuid)", [
        other,
        NOW,
        mine[0]!.id,
      ]);
      expect(r).toMatchObject({ ok: false, error: { message: "NOT_FOUND" } });
      const s = await attempt(pg, "select app_private.get_session_summary($1::uuid, $2::timestamptz, $3::uuid)", [
        other,
        NOW,
        mine[0]!.id,
      ]);
      expect(s).toMatchObject({ ok: false, error: { message: "NOT_FOUND" } });
    });

    it("the status of a session past its cutoff is read-time derived, not stale", async () => {
      // 11-04 was partial. Read long after cutoff: still partial and the correction window is closed.
      const id = (
        await rows<{ id: string }>(
          pg,
          "select id from public.night_sessions where user_id = $1 and fajr_local_date = $2",
          [uid, day(4)],
        )
      )[0]!.id;
      const later = nightSessionSchema.parse(await q(pg, uid, at(20), "get_session_json", [id], ["uuid"]));
      expect(later.state).toBe("partial");
      expect(later.correction_window_open).toBe(false);
    });

    it("the summary holds the progress at the session's level and does not change status", async () => {
      const id = (
        await rows<{ id: string }>(
          pg,
          "select id from public.night_sessions where user_id = $1 and fajr_local_date = $2",
          [uid, day(7)],
        )
      )[0]!.id;
      const before = await rows(pg, "select status, version from public.night_sessions where id = $1", [id]);
      const s = sessionSummarySchema.parse(await q(pg, uid, NOW, "get_session_summary", [id], ["uuid"]));
      expect(s).toMatchObject({
        session_status: "completed",
        successful_nights_at_level: 3,
        required_successful_nights: 7,
        current_level: 1,
        next_level_unlocked: false,
        next_level_effective_session_key: null,
      });
      expect(await rows(pg, "select status, version from public.night_sessions where id = $1", [id])).toEqual(before);
    });

    it("current level reports the effective date of Level 1 as the program start", async () => {
      expect(await q(pg, uid, NOW, "get_current_level")).toEqual({ level: 1, effective_from_session_key: day(1) });
    });
  });

  describe("entitlement is checked on every read", () => {
    it.each(["pending_verification", "suspended", "revoked", "expired", "none"] as const)(
      "%s: no private data",
      async (ent) => {
        const u = await createUser(pg, { entitlement: ent });
        for (const [fn, args] of [
          ["dashboard_json", []],
          ["calendar_json", [null, null]],
          ["session_history_json", []],
          ["get_level_progress", []],
          ["get_activity_stats", []],
          ["active_session_json", []],
          ["prayer_row_json", ["2026-11-12"]],
          ["list_regions", []],
        ] as [string, unknown[]][]) {
          const extra = args.map((_, i) => `$${i + 3}`).join(", ");
          const r = await attempt(
            pg,
            `select app_private.${fn}($1::uuid, $2::timestamptz${extra ? ", " + extra : ""})`,
            [u, NOW, ...args],
          );
          expect(r, fn).toMatchObject({ ok: false, error: { message: "ENTITLEMENT_INACTIVE" } });
        }
      },
    );
  });

  describe("public wrappers run as the signed-in user", () => {
    it("get_dashboard returns only the caller's data and anon gets nothing", async () => {
      const mine = await as(pg, "authenticated", uid, () =>
        rows<{ r: { status_counts: { completed: number } } }>(pg, "select public.get_dashboard() as r"),
      );
      expect(mine[0]!.r.status_counts.completed).toBe(3);
      const theirs = await as(pg, "authenticated", other, () =>
        rows<{ r: { status_counts: { completed: number } } }>(pg, "select public.get_dashboard() as r"),
      );
      expect(theirs[0]!.r.status_counts.completed).toBe(1);
      const anon = await as(pg, "anon", null, () => attempt(pg, "select public.get_dashboard()"));
      expect(anon).toMatchObject({ ok: false, error: { code: "42501" } });
    });
    it("a signed-in role without a user claim is refused", async () => {
      const r = await as(pg, "authenticated", null, () => attempt(pg, "select public.get_dashboard()"));
      expect(r).toMatchObject({ ok: false, error: { message: "UNAUTHENTICATED" } });
    });
  });
});
