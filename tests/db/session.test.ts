import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activeSessionKey, correctionDeadline } from "../../src/domain/session/keys";
import { addDays } from "../../src/domain/time/tz";
import { activityId, applyOp, attempt, completeSession, createTestDb, createUser, rows, startSession } from "./harness";

const at = (date: string, time = "02:00") => `${date}T${time}:00+07:00`;

describe("night sessions in SQL", () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await createTestDb();
  });
  afterAll(async () => pg.close());

  describe("session key (PRD §11.1)", () => {
    it("one session per user and Fajr date, enforced by the table", async () => {
      const u = await createUser(pg);
      const first = await startSession(pg, u, at("2026-11-12"));
      const again = await startSession(pg, u, at("2026-11-12", "09:30"));
      expect(first.created).toBe(true);
      expect(again).toMatchObject({ created: false, session_id: first.session_id });
      const dup = await attempt(
        pg,
        "insert into public.night_sessions (user_id, fajr_local_date, timezone, schedule_source, level_number) values ($1, '2026-11-12', 'Asia/Jakarta', 'provider', 1)",
        [u],
      );
      expect(dup).toMatchObject({ ok: false, error: { code: "23505" } });
      expect((await rows(pg, "select 1 from public.night_sessions where user_id = $1", [u])).length).toBe(1);
    });

    it("SESSION-03 the key is D at 11.59 WIB and D+1 at 12.00", async () => {
      const u = await createUser(pg);
      expect((await startSession(pg, u, "2026-11-13T11:59:00+07:00")).session_key.slice(0, 10)).toBe("2026-11-13");
      expect((await startSession(pg, u, "2026-11-13T12:00:00+07:00")).session_key.slice(0, 10)).toBe("2026-11-14");
      expect((await startSession(pg, u, "2026-11-13T12:01:00+07:00")).session_key.slice(0, 10)).toBe("2026-11-14");
    });

    it("SESSION-01 23.50 and 00.20 belong to the same session", async () => {
      const u = await createUser(pg);
      const a = await startSession(pg, u, "2026-11-12T23:50:00+07:00");
      const b = await startSession(pg, u, "2026-11-13T00:20:00+07:00");
      expect(b.session_id).toBe(a.session_id);
      expect(a.session_key.slice(0, 10)).toBe("2026-11-13");
    });

    it.each([
      ["demo-jakarta", "DEMO-JKT", "Asia/Jakarta"],
      ["demo-makassar", "DEMO-MKS", "Asia/Makassar"],
      ["demo-jayapura", "DEMO-DJJ", "Asia/Jayapura"],
    ])("agrees with the domain activeSessionKey for %s across the cutoff", async (_n, region, tz) => {
      const u = await createUser(pg, { region });
      for (const iso of [
        "2026-11-13T04:30:00Z",
        "2026-11-13T03:59:59Z",
        "2026-11-13T04:00:00Z",
        "2026-11-13T05:00:00Z",
        "2026-11-12T17:30:00Z",
        "2026-12-31T20:00:00Z",
      ]) {
        const s = await startSession(pg, u, iso);
        expect(s.session_key.slice(0, 10), `${tz} ${iso}`).toBe(activeSessionKey(new Date(iso), tz));
      }
    });

    it("works for a manual schedule in another zone (Asia/Riyadh)", async () => {
      const u = await createUser(pg, { region: null });
      await pg.query(
        `update public.profiles set manual_schedule = '{"fajr":"04:45","timezone":"Asia/Riyadh"}' where user_id = $1`,
        [u],
      );
      const s = await startSession(pg, u, "2026-11-13T08:59:00Z"); // 11:59 in Riyadh (UTC+3)
      expect(s).toMatchObject({ timezone: "Asia/Riyadh" });
      expect(s.session_key.slice(0, 10)).toBe("2026-11-13");
      expect((await startSession(pg, u, "2026-11-13T09:00:00Z")).session_key.slice(0, 10)).toBe("2026-11-14");
      const src = await rows<{ schedule_source: string }>(
        pg,
        "select schedule_source from public.night_sessions where id = $1",
        [s.session_id],
      );
      expect(src[0]!.schedule_source).toBe("manual");
    });

    it("needs a location before a session can start", async () => {
      const u = await createUser(pg, { region: null });
      expect(await attempt(pg, "select app_private.ensure_active_session($1::uuid, now())", [u])).toMatchObject({
        ok: false,
        error: { message: "LOCATION_REQUIRED" },
      });
    });

    it("SESSION-04 changing region mid-session keeps the old zone, the next session uses the new one", async () => {
      const u = await createUser(pg);
      const first = await startSession(pg, u, at("2026-11-12"));
      await pg.query(
        "update public.profiles set region_id = (select id from public.regions where provider_region_code = 'DEMO-MKS') where user_id = $1",
        [u],
      );
      const same = await startSession(pg, u, at("2026-11-12", "03:00"));
      expect(same).toMatchObject({ session_id: first.session_id, timezone: "Asia/Jakarta" });
      const next = await startSession(pg, u, at("2026-11-13"));
      expect(next).toMatchObject({ timezone: "Asia/Makassar", created: true });
      expect(next.session_id).not.toBe(first.session_id);
    });
  });

  describe("snapshot (PRD §11.5, §22.3)", () => {
    it("LEVEL-05 an admin change to a target does not touch sessions already created", async () => {
      const u = await createUser(pg);
      const s = await startSession(pg, u, at("2026-11-12"));
      const act = await activityId(pg, s.session_id, "istighfar");
      const before = await rows<{ t: number; snap: { title: string; kind: string } }>(
        pg,
        "select target_count as t, activity_config_snapshot as snap from public.session_activities where id = $1",
        [act],
      );
      expect(before[0]).toMatchObject({ t: 100, snap: { title: "Istighfar", kind: "counter" } });

      await pg.exec(`update public.level_activity_config set target_count = 999, config_version = 2
        where activity_definition_id = (select id from public.activity_definitions where activity_key = 'istighfar')
          and level_id = (select id from public.levels where level_number = 1) and phase = 'night'`);
      const old = await rows<{ t: number }>(
        pg,
        "select target_count as t from public.session_activities where id = $1",
        [act],
      );
      expect(old[0]!.t).toBe(100);
      const next = await startSession(pg, u, at("2026-11-13"));
      const fresh = await activityId(pg, next.session_id, "istighfar");
      const t = await rows<{ t: number; v: number }>(
        pg,
        "select s.target_count as t, n.level_config_version as v from public.session_activities s join public.night_sessions n on n.id = s.session_id where s.id = $1",
        [fresh],
      );
      expect(t[0]).toEqual({ t: 999, v: 2 });
      await pg.exec(`update public.level_activity_config set target_count = 100, config_version = 1
        where activity_definition_id = (select id from public.activity_definitions where activity_key = 'istighfar')
          and level_id = (select id from public.levels where level_number = 1) and phase = 'night'`);
    });

    it("copies the activities of the user's level, with per-level wording and one row per phase", async () => {
      const u = await createUser(pg);
      const s = await startSession(pg, u, at("2026-11-12"));
      const r = await rows<{ phase: string; key: string; kind: string; req: boolean; title: string }>(
        pg,
        `select phase, activity_config_snapshot ->> 'activity_key' as key, activity_config_snapshot ->> 'kind' as kind,
                required_for_completion as req, activity_config_snapshot ->> 'title' as title
         from public.session_activities where session_id = $1`,
        [s.session_id],
      );
      expect(
        r
          .filter((x) => x.key === "tahlil")
          .map((x) => x.phase)
          .sort(),
      ).toEqual(["night", "post_fajr"]);
      expect(r.find((x) => x.key === "salat_witir_1")!.title).toBe("Salat Witir");
      expect(r.find((x) => x.key === "salat_tahajud")).toMatchObject({ kind: "checklist", req: true });
      expect(r.find((x) => x.key === "tilawah")).toMatchObject({ req: false });
      expect(r.find((x) => x.key === "istighfar")).toMatchObject({ kind: "counter" });
      expect(r.filter((x) => x.phase === "night" && x.kind === "counter" && x.req)).toHaveLength(4);
    });
  });

  describe("status is computed from the data (PRD §10.3-10.5)", () => {
    it("scheduled, then in_progress, then completed as soon as every required activity is done", async () => {
      const u = await createUser(pg);
      const s = await startSession(pg, u, at("2026-11-12"));
      const status = async () =>
        (
          await rows<{ status: string }>(pg, "select status from public.night_sessions where id = $1", [s.session_id])
        )[0]!.status;
      expect(await status()).toBe("scheduled");
      await applyOp(pg, u, at("2026-11-12"), await activityId(pg, s.session_id, "istighfar"), "p1", "delta", 5);
      expect(await status()).toBe("in_progress");
      await completeSession(pg, u, s.session_id, at("2026-11-12", "05:00"));
      expect(await status()).toBe("completed");
      const row = await rows<{ started_at: Date | null; completed_at: Date | null; closed_at: Date | null }>(
        pg,
        "select started_at, completed_at, closed_at from public.night_sessions where id = $1",
        [s.session_id],
      );
      expect(row[0]!.started_at).not.toBeNull();
      expect(row[0]!.completed_at).not.toBeNull();
      expect(row[0]!.closed_at).toBeNull(); // cutoff has not passed yet
    });

    it("BUG-07 after the cutoff: progress without completion is partial, no progress is missed", async () => {
      const [a, b] = [await createUser(pg), await createUser(pg)];
      const [sa, sb] = [await startSession(pg, a, at("2026-11-12")), await startSession(pg, b, at("2026-11-12"))];
      await applyOp(
        pg,
        a,
        at("2026-11-12", "03:00"),
        await activityId(pg, sa.session_id, "istighfar"),
        "x1",
        "delta",
        5,
      );
      const later = at("2026-11-12", "12:30");
      const ra = await rows<{ s: string }>(pg, "select app_private.refresh_session($1::uuid, $2::timestamptz) as s", [
        sa.session_id,
        later,
      ]);
      const rb = await rows<{ s: string }>(pg, "select app_private.refresh_session($1::uuid, $2::timestamptz) as s", [
        sb.session_id,
        later,
      ]);
      expect([ra[0]!.s, rb[0]!.s]).toEqual(["partial", "missed"]);
      const closed = await rows<{ c: boolean }>(
        pg,
        "select closed_at is not null as c from public.night_sessions where id = $1",
        [sa.session_id],
      );
      expect(closed[0]!.c).toBe(true);
    });

    it("excused wins over any progress", async () => {
      const u = await createUser(pg);
      const s = await startSession(pg, u, at("2026-11-12"));
      await pg.query("update public.night_sessions set excused_at = now() where id = $1", [s.session_id]);
      await completeSession(pg, u, s.session_id, at("2026-11-12", "05:00"));
      expect(
        (
          await rows<{ status: string }>(pg, "select status from public.night_sessions where id = $1", [s.session_id])
        )[0]!.status,
      ).toBe("excused");
    });

    it("optional activities never block completion", async () => {
      const u = await createUser(pg);
      const s = await startSession(pg, u, at("2026-11-12"));
      await completeSession(pg, u, s.session_id, at("2026-11-12", "05:00"));
      const optional = await rows<{ n: string }>(
        pg,
        "select count(*)::text as n from public.session_activities where session_id = $1 and not required_for_completion and status <> 'pending'",
        [s.session_id],
      );
      expect(optional[0]!.n).toBe("0");
      expect(
        (
          await rows<{ status: string }>(pg, "select status from public.night_sessions where id = $1", [s.session_id])
        )[0]!.status,
      ).toBe("completed");
    });
  });

  describe("set_checklist", () => {
    let u: string;
    let sid: string;
    let doa: string;
    beforeAll(async () => {
      u = await createUser(pg);
      const s = await startSession(pg, u, at("2026-11-12"));
      sid = s.session_id;
      doa = await activityId(pg, sid, "doa");
    });
    const call = (now: string, id: string, checked: boolean, version: number) =>
      attempt<{ r: { checked: boolean; version: number; session_status: string } }>(
        pg,
        "select app_private.set_checklist($1::uuid, $2::timestamptz, $3::uuid, $4, $5::int) as r",
        [u, now, id, checked, version],
      );

    it("ticks with the current version and returns the next one", async () => {
      const r = await call(at("2026-11-12"), doa, true, 0);
      expect(r.ok && r.rows[0]!.r).toMatchObject({ checked: true, version: 1, session_status: "in_progress" });
    });

    it("refuses a stale version with the server value in the detail", async () => {
      const r = await call(at("2026-11-12"), doa, false, 0);
      expect(r).toMatchObject({ ok: false, error: { message: "VERSION_CONFLICT" } });
      expect(r.ok === false && JSON.parse(r.error.detail!)).toEqual({ checked: true, version: 1 });
      const ok = await call(at("2026-11-12"), doa, false, 1);
      expect(ok.ok && ok.rows[0]!.r).toMatchObject({ checked: false, version: 2 });
    });

    it("refuses counters, strangers, and missing activities", async () => {
      const counter = await activityId(pg, sid, "istighfar");
      expect(await call(at("2026-11-12"), counter, true, 0)).toMatchObject({
        ok: false,
        error: { message: "VALIDATION_ERROR" },
      });
      expect(await call(at("2026-11-12"), "99999999-9999-4999-8999-999999999999", true, 0)).toMatchObject({
        ok: false,
        error: { message: "NOT_FOUND" },
      });
    });

    it("keeps an audit entry for a correction after the cutoff, and locks after 48 hours", async () => {
      const edit = await call(at("2026-11-12", "13:00"), doa, true, 2); // after cutoff, inside the window
      expect(edit.ok).toBe(true);
      const audit = await rows<{ operation_type: string; new_value: { checked: boolean } }>(
        pg,
        "select operation_type, new_value from public.session_audit_logs where session_id = $1",
        [sid],
      );
      expect(audit).toEqual([
        { operation_type: "checklist_set", new_value: expect.objectContaining({ checked: true }) },
      ]);

      const deadline = correctionDeadline("2026-11-12", "Asia/Jakarta");
      const inside = await call(deadline.toISOString(), doa, false, 3);
      expect(inside.ok).toBe(true);
      const locked = await call(new Date(deadline.getTime() + 1000).toISOString(), doa, true, 4);
      expect(locked).toMatchObject({ ok: false, error: { message: "SESSION_LOCKED" } });
    });
  });

  describe("levels (PRD §10.7)", () => {
    it("LEVEL-01 a new account starts at Level 1 with Level 2 and 3 locked", async () => {
      const u = await createUser(pg);
      await startSession(pg, u, at("2026-11-12"));
      const st = await rows<{ current_level: number; l2: Date | null; l3: Date | null; eff: Date | null }>(
        pg,
        "select current_level, level_2_unlocked_at as l2, level_3_unlocked_at as l3, effective_from_session_key as eff from public.user_level_state where user_id = $1",
        [u],
      );
      expect(st[0]).toEqual({ current_level: 1, l2: null, l3: null, eff: null });
    });

    it("LEVEL-02/03/04, SESSION-05: unlock after the 7th completed night, from the next session, and never relocks", async () => {
      const u = await createUser(pg);
      let day = "2026-11-12";
      const ids: string[] = [];
      for (let i = 1; i <= 7; i++) {
        if (i === 4) day = addDays(day, 1); // a missed night in between: progress must not drop
        const s = await startSession(pg, u, at(day));
        ids.push(s.session_id);
        expect(s.level_number).toBe(1);
        await completeSession(pg, u, s.session_id, at(day, "05:00"));
        const st = await rows<{ l2: Date | null }>(
          pg,
          "select level_2_unlocked_at as l2 from public.user_level_state where user_id = $1",
          [u],
        );
        if (i < 7) expect(st[0]!.l2, `after night ${i}`).toBeNull();
        day = addDays(day, 1);
      }
      const seventhKey = addDays(day, -1);
      const state = await rows<{ l2: Date | null; eff: string; cur: number }>(
        pg,
        "select level_2_unlocked_at as l2, level_2_effective_from::text as eff, current_level as cur from public.user_level_state where user_id = $1",
        [u],
      );
      expect(state[0]!.l2).not.toBeNull();
      expect(state[0]!.eff).toBe(day); // the day after the 7th session
      expect(state[0]!.cur).toBe(1); // LEVEL-04: the running session is still Level 1
      const running = await rows<{ level_number: number; status: string }>(
        pg,
        "select level_number, status from public.night_sessions where id = $1",
        [ids[6]],
      );
      expect(running[0]).toEqual({ level_number: 1, status: "completed" });
      void seventhKey;

      // next session is Level 2 with its own activity list
      const next = await startSession(pg, u, at(day));
      expect(next.level_number).toBe(2);
      expect(
        (
          await rows(
            pg,
            "select 1 from public.session_activities where session_id = $1 and activity_config_snapshot ->> 'activity_key' = 'hasbunallah'",
            [next.session_id],
          )
        ).length,
      ).toBe(1);

      // SESSION-05: a correction lowers Level 1 to 6 completed nights, Level 2 stays open
      const doa = await activityId(pg, ids[6]!, "doa");
      const cur = (
        await rows<{ version: number }>(pg, "select version from public.session_activities where id = $1", [doa])
      )[0]!.version;
      await pg.query("select app_private.set_checklist($1::uuid, $2::timestamptz, $3::uuid, false, $4::int)", [
        u,
        at(day),
        doa,
        cur,
      ]);
      const after = await rows<{ done: string; l2: Date | null; cur: number }>(
        pg,
        `select (select count(*)::text from public.night_sessions where user_id = $1 and level_number = 1 and status = 'completed') as done,
                level_2_unlocked_at as l2, current_level as cur from public.user_level_state where user_id = $1`,
        [u],
      );
      expect(after[0]!.done).toBe("6");
      expect(after[0]!.l2).not.toBeNull();
      expect(after[0]!.cur).toBe(2);
    });

    it("unlocks Level 3 after 12 Level 2 nights and completes the journey after 20 Level 3 nights, staying at Level 3", async () => {
      const u = await createUser(pg);
      let day = "2026-11-12";
      const levels: number[] = [];
      for (let i = 1; i <= 39; i++) {
        const s = await startSession(pg, u, at(day));
        levels.push(s.level_number);
        await completeSession(pg, u, s.session_id, at(day, "05:00"));
        day = addDays(day, 1);
      }
      expect(levels.slice(0, 7).every((l) => l === 1)).toBe(true);
      expect(levels.slice(7, 19).every((l) => l === 2)).toBe(true);
      expect(levels.slice(19).every((l) => l === 3)).toBe(true);
      const st = await rows<{ cur: number; l3: Date | null; journey: Date | null; eff: string }>(
        pg,
        "select current_level as cur, level_3_unlocked_at as l3, journey_completed_at as journey, effective_from_session_key::text as eff from public.user_level_state where user_id = $1",
        [u],
      );
      expect(st[0]!.cur).toBe(3);
      expect(st[0]!.journey).not.toBeNull();
      expect(st[0]!.eff).toBe("2026-12-01"); // day 20 of the run, the first Level 3 session
      const next = await startSession(pg, u, at(day)); // no Level 4: still Level 3
      expect(next.level_number).toBe(3);
    });
  });
});
