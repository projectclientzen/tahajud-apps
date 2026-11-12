import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError, type NightSession } from "@/data/contracts";
import { getAmalan } from "@/domain/content/amalan";
import { createLayerSender } from "@/offline/sender";
import type { QueueItem } from "@/offline/types";
import { createApiEnv, type ApiEnv, type TestBrowser } from "./api-harness";

const DAY = 86_400_000;
const owner = getAmalan();

async function errorOf(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("expected an ApiError");
}

describe("worship over HTTP: the live data layer end to end", () => {
  let env: ApiEnv;
  beforeAll(async () => {
    env = await createApiEnv("2026-11-12T02:00:00+07:00");
  });
  afterAll(async () => env.close());
  // Tests move the clock. Each one starts from the same night.
  beforeEach(async () => env.setNow("2026-11-12T02:00:00+07:00"));
  const nowIso = () => env.now().toISOString();

  async function user(email: string): Promise<{ b: TestBrowser; s: NightSession }> {
    const b = await env.onboarded(email);
    return { b, s: await b.data().session.ensureActiveSession() };
  }
  const counter = (s: NightSession, key: string, phase = "night") =>
    s.activities.find((a) => a.key === key && a.phase === phase)!;

  describe("session", () => {
    it("is created once per key: asking again returns the same session", async () => {
      const { b, s } = await user("w1@ngajigaes.test");
      const again = await b.data().session.ensureActiveSession();
      expect(again.id).toBe(s.id);
      expect((await b.data().session.getActiveSession())!.id).toBe(s.id);
      expect(s).toMatchObject({
        session_key: "2026-11-12",
        level: 1,
        status: "upcoming",
        state: "scheduled",
        timezone: "Asia/Jakarta",
      });
    });

    it("is null until the first interaction creates it", async () => {
      const b = await env.onboarded("w2@ngajigaes.test");
      expect(await b.data().session.getActiveSession()).toBeNull();
    });

    it("carries the level's activities in order, with the targets from the owner's content", async () => {
      const { s } = await user("w3@ngajigaes.test");
      const cfg = owner.levels[1].activities;
      expect(s.activities.map((a) => `${a.phase}:${a.key}`)).toEqual(cfg.map((a) => a.id));
      for (const a of s.activities) {
        const c = cfg.find((x) => x.id === `${a.phase}:${a.key}`)!;
        expect(a).toMatchObject({ kind: c.kind, target: c.target, required: c.required, type: c.type, title: c.title });
      }
    });

    it("passes the owner's Arabic text through byte for byte, and no text for anything else (DZIKIR)", async () => {
      const { s } = await user("w4@ngajigaes.test");
      for (const a of s.activities) {
        const cfg = owner.levels[1].activities.find((x) => x.id === `${a.phase}:${a.key}`)!;
        if (cfg.dhikrRef) {
          const expected = owner.dhikr[cfg.dhikrRef]!.arabicText;
          expect(a.arabic_text, a.key).toBe(expected);
          expect(Buffer.from(a.arabic_text!, "utf8").equals(Buffer.from(expected, "utf8"))).toBe(true);
          expect(a.dhikr_review_status).toBe("published");
        } else {
          expect(a.arabic_text, a.key).toBeNull();
        }
      }
    });

    it("does not make up transliteration or meaning: the contract has no field for them", async () => {
      const { s } = await user("w5@ngajigaes.test");
      for (const a of s.activities) expect(Object.keys(a)).not.toContain("transliteration");
    });
  });

  describe("DZIKIR counters", () => {
    it("DZIKIR-03: an operation sent twice counts once and says duplicate", async () => {
      const { b, s } = await user("z1@ngajigaes.test");
      const id = counter(s, "istighfar").id;
      const op = { kind: "delta" as const, operation_id: "z1-a", delta: 10, client_recorded_at: nowIso() };
      const first = await b.data().session.applyCounterOperations(id, { operations: [op] });
      const second = await b.data().session.applyCounterOperations(id, { operations: [op] });
      expect(first.results[0]).toMatchObject({
        status: "accepted",
        authoritative_count: 10,
        target: 100,
        completed: false,
      });
      expect(second.results[0]).toMatchObject({ status: "duplicate", authoritative_count: 10 });
      expect(counter(await b.data().session.getSession(s.id), "istighfar").count).toBe(10);
    });

    it("DZIKIR-03: a batch with a repeated operation id inside it counts once", async () => {
      const { b, s } = await user("z2@ngajigaes.test");
      const id = counter(s, "shalawat").id;
      const op = { kind: "delta" as const, operation_id: "z2-a", delta: 4, client_recorded_at: nowIso() };
      const r = await b
        .data()
        .session.applyCounterOperations(id, { operations: [op, op, { ...op, operation_id: "z2-b", delta: 1 }] });
      expect(r.results.map((x) => x.status)).toEqual(["accepted", "duplicate", "accepted"]);
      expect(r.results.at(-1)!.authoritative_count).toBe(5);
    });

    it("DZIKIR-03: the same operation id from another device is still once", async () => {
      const { b, s } = await user("z3@ngajigaes.test");
      const other = await env.signIn("z3@ngajigaes.test");
      const id = counter(s, "tahlil").id;
      const op = { kind: "delta" as const, operation_id: "z3-a", delta: 20, client_recorded_at: nowIso() };
      await b.data().session.applyCounterOperations(id, { operations: [op] });
      const r = await other.data().session.applyCounterOperations(id, { operations: [op] });
      expect(r.results[0]).toMatchObject({ status: "duplicate", authoritative_count: 20 });
    });

    it("DZIKIR-05: the count never goes below zero", async () => {
      const { b, s } = await user("z4@ngajigaes.test");
      const id = counter(s, "istighfar").id;
      const r = await b.data().session.applyCounterOperations(id, {
        operations: [
          { kind: "delta", operation_id: "z4-a", delta: 3, client_recorded_at: nowIso() },
          { kind: "delta", operation_id: "z4-b", delta: -50, client_recorded_at: nowIso() },
          { kind: "delta", operation_id: "z4-c", delta: 2, client_recorded_at: nowIso() },
        ],
      });
      expect(r.results.map((x) => x.authoritative_count)).toEqual([3, 0, 2]);
    });

    it("DZIKIR-05: reset to zero keeps later taps and is an audited correction", async () => {
      const { b, s } = await user("z5@ngajigaes.test");
      const id = counter(s, "istighfar").id;
      await b
        .data()
        .session.applyCounterOperations(id, {
          operations: [{ kind: "delta", operation_id: "z5-a", delta: 40, client_recorded_at: nowIso() }],
        });
      const r = await b.data().session.applyCounterOperations(id, {
        operations: [
          { kind: "set_zero", operation_id: "z5-b", client_recorded_at: nowIso() },
          { kind: "delta", operation_id: "z5-c", delta: 6, client_recorded_at: nowIso() },
        ],
      });
      expect(r.results.map((x) => x.authoritative_count)).toEqual([0, 6]);
      const audit = await env.db.exec(
        "select operation_type from public.session_audit_logs where session_id = $1::uuid",
        [s.id],
      );
      expect(audit.map((a) => a.operation_type)).toContain("counter_set_zero");
    });

    it("refuses a delta of 0 or beyond 1000 per operation, one by one", async () => {
      const { b, s } = await user("z6@ngajigaes.test");
      const id = counter(s, "istighfar").id;
      const zero = await b
        .data()
        .session.applyCounterOperations(id, {
          operations: [{ kind: "delta", operation_id: "z6-0", delta: 0, client_recorded_at: nowIso() }],
        });
      expect(zero.results[0]).toMatchObject({ status: "rejected", error_code: "INVALID_DELTA" });
      const big = await b.json(`/session-activities/${id}/counter-operations`, "POST", {
        operations: [{ kind: "delta", operation_id: "z6-big", delta: 1001, client_recorded_at: nowIso() }],
      });
      expect(big.status).toBe(400);
    });

    it("takes at most 50 operations per request", async () => {
      const { b, s } = await user("z7@ngajigaes.test");
      const id = counter(s, "istighfar").id;
      const ops = (n: number, p: string) =>
        Array.from({ length: n }, (_, i) => ({
          kind: "delta" as const,
          operation_id: `${p}-${i}`,
          delta: 1,
          client_recorded_at: nowIso(),
        }));
      expect((await errorOf(b.data().session.applyCounterOperations(id, { operations: ops(51, "big") }))).code).toBe(
        "VALIDATION_ERROR",
      );
      const ok = await b.data().session.applyCounterOperations(id, { operations: ops(50, "ok") });
      expect(ok.results.at(-1)!.authoritative_count).toBe(50);
      expect((await errorOf(b.data().session.applyCounterOperations(id, { operations: [] }))).code).toBe(
        "VALIDATION_ERROR",
      );
    });

    it("tells the app when a target is reached", async () => {
      const { b, s } = await user("z8@ngajigaes.test");
      const a = counter(s, "pf_allahu_akbar_kabira", "post_fajr");
      const r = await b
        .data()
        .session.applyCounterOperations(a.id, {
          operations: [{ kind: "delta", operation_id: "z8", delta: a.target!, client_recorded_at: nowIso() }],
        });
      expect(r.results[0]).toMatchObject({ completed: true, authoritative_count: a.target });
      expect(counter(await b.data().session.getSession(s.id), "pf_allahu_akbar_kabira", "post_fajr").completed).toBe(
        true,
      );
    });

    it("a client clock far ahead does not move the server's record", async () => {
      const { b, s } = await user("z9@ngajigaes.test");
      const id = counter(s, "istighfar").id;
      await b
        .data()
        .session.applyCounterOperations(id, {
          operations: [{ kind: "delta", operation_id: "z9", delta: 1, client_recorded_at: "2099-01-01T00:00:00.000Z" }],
        });
      const row = await env.db.exec(
        "select client_recorded_at < now() + interval '1 day' as sane from public.counter_operations where client_operation_id = 'z9'",
      );
      expect(row[0]!.sane).toBe(true);
    });

    it("works through the offline sender: a retry after a lost answer counts once", async () => {
      const { b, s } = await user("z10@ngajigaes.test");
      const layer = b.data();
      const sender = createLayerSender(layer);
      const id = counter(s, "istighfar").id;
      const item = (n: number): QueueItem => ({
        seq: n,
        operation_id: `q-${n}`,
        user_id: "u",
        entity_id: id,
        operation_type: "counter_delta",
        payload: { delta: 5, client_recorded_at: nowIso() },
        client_timestamp: nowIso(),
        sync_status: "pending",
        attempt_count: 0,
        next_attempt_at: null,
        last_error: null,
      });
      expect(await sender.send([item(1), item(2)])).toEqual([{ kind: "synced" }, { kind: "synced" }]);
      expect(await sender.send([item(1), item(2), item(3)])).toEqual([
        { kind: "synced" },
        { kind: "synced" },
        { kind: "synced" },
      ]);
      expect(counter(await layer.session.getSession(s.id), "istighfar").count).toBe(15);
    });
  });

  describe("checklist versions and the offline sender (PRD §21.3)", () => {
    const checklist = (s: NightSession) => s.activities.find((a) => a.kind === "checklist" && a.key === "doa")!;

    it("a tick bumps the version", async () => {
      const { b, s } = await user("c1@ngajigaes.test");
      const a = checklist(s);
      const next = await b.data().session.setChecklist(a.id, { checked: true, version: a.version });
      expect(checklist(next)).toMatchObject({ checked: true, version: a.version + 1, completed: true });
    });

    it("an old version is VERSION_CONFLICT with the server value in details.server", async () => {
      const { b, s } = await user("c2@ngajigaes.test");
      const second = await env.signIn("c2@ngajigaes.test");
      const a = checklist(s);
      await b.data().session.setChecklist(a.id, { checked: true, version: a.version });
      const e = await errorOf(second.data().session.setChecklist(a.id, { checked: false, version: a.version }));
      expect(e.code).toBe("VERSION_CONFLICT");
      expect(e.details).toEqual({ server: { checked: true, version: a.version + 1 } });
    });

    it("the sender applies the user's tick again on the server's version when it still changes something", async () => {
      const { b, s } = await user("c3@ngajigaes.test");
      const second = await env.signIn("c3@ngajigaes.test");
      const a = checklist(s);
      await b.data().session.setChecklist(a.id, { checked: true, version: a.version });
      const item: QueueItem = {
        seq: 1,
        operation_id: "c3",
        user_id: "u",
        entity_id: a.id,
        operation_type: "checklist_set",
        payload: { checked: false, version: a.version },
        client_timestamp: nowIso(),
        sync_status: "pending",
        attempt_count: 0,
        next_attempt_at: null,
        last_error: null,
      };
      expect(await createLayerSender(second.data()).send([item])).toEqual([{ kind: "synced" }]);
      expect(checklist(await b.data().session.getSession(s.id)).checked).toBe(false);
    });

    it("the sender drops a tick the server already has, without a second write", async () => {
      const { b, s } = await user("c4@ngajigaes.test");
      const second = await env.signIn("c4@ngajigaes.test");
      const a = checklist(s);
      await b.data().session.setChecklist(a.id, { checked: true, version: a.version });
      const item: QueueItem = {
        seq: 1,
        operation_id: "c4",
        user_id: "u",
        entity_id: a.id,
        operation_type: "checklist_set",
        payload: { checked: true, version: a.version },
        client_timestamp: nowIso(),
        sync_status: "pending",
        attempt_count: 0,
        next_attempt_at: null,
        last_error: null,
      };
      expect(await createLayerSender(second.data()).send([item])).toEqual([{ kind: "synced" }]);
      expect(checklist(await b.data().session.getSession(s.id)).version).toBe(a.version + 1);
    });
  });

  describe("the correction window (SESSION_LOCKED)", () => {
    it("closes 48 hours after the 12:00 cutoff of the session date, for checklists and counters alike", async () => {
      await env.setNow("2026-11-12T02:00:00+07:00");
      const { b, s } = await user("l1@ngajigaes.test");
      const ck = s.activities.find((a) => a.kind === "checklist")!;
      const ct = counter(s, "istighfar");
      // key 2026-11-12: cutoff 11-12 12:00, window ends 11-14 12:00 (WIB)
      await env.setNow("2026-11-14T11:59:00+07:00");
      expect((await b.data().session.getSession(s.id)).correction_window_open).toBe(true);
      const okTick = await b.data().session.setChecklist(ck.id, { checked: true, version: ck.version });
      expect(okTick.state).not.toBe("scheduled");
      await env.setNow("2026-11-14T12:01:00+07:00");
      expect((await b.data().session.getSession(s.id)).correction_window_open).toBe(false);
      const e = await errorOf(b.data().session.setChecklist(ck.id, { checked: false, version: ck.version + 1 }));
      expect(e).toMatchObject({ code: "SESSION_LOCKED" });
      const r = await b
        .data()
        .session.applyCounterOperations(ct.id, {
          operations: [{ kind: "delta", operation_id: "late-1", delta: 5, client_recorded_at: nowIso() }],
        });
      expect(r.results[0]).toMatchObject({ status: "rejected", error_code: "SESSION_LOCKED" });
      await env.setNow("2026-11-12T02:00:00+07:00");
    });

    it("the offline sender shows a locked session as rejected, never retries it forever", async () => {
      await env.setNow("2026-11-12T02:00:00+07:00");
      const { b, s } = await user("l2@ngajigaes.test");
      const ck = s.activities.find((a) => a.kind === "checklist")!;
      await env.setNow("2026-11-20T10:00:00+07:00");
      const item: QueueItem = {
        seq: 1,
        operation_id: "l2",
        user_id: "u",
        entity_id: ck.id,
        operation_type: "checklist_set",
        payload: { checked: true, version: ck.version },
        client_timestamp: nowIso(),
        sync_status: "pending",
        attempt_count: 0,
        next_attempt_at: null,
        last_error: null,
      };
      expect(await createLayerSender(b.data()).send([item])).toEqual([{ kind: "rejected", code: "SESSION_LOCKED" }]);
      await env.setNow("2026-11-12T02:00:00+07:00");
    });

    it("a new day opens a new session and the old one is not touched", async () => {
      await env.setNow("2026-11-12T02:00:00+07:00");
      const { b, s } = await user("l3@ngajigaes.test");
      await env.setNow("2026-11-12T13:00:00+07:00"); // after the cutoff: the active key is tomorrow
      const next = await b.data().session.ensureActiveSession();
      expect(next.session_key).toBe("2026-11-13");
      expect(next.id).not.toBe(s.id);
      expect((await b.data().session.getSession(s.id)).state).toBe("missed");
      await env.setNow("2026-11-12T02:00:00+07:00");
    });
  });

  describe("progress, summary and reports", () => {
    async function completeNight(b: TestBrowser, s: NightSession, tag: string) {
      const layer = b.data();
      for (const a of s.activities.filter((x) => x.required)) {
        if (a.kind === "checklist") await layer.session.setChecklist(a.id, { checked: true, version: a.version });
        else
          await layer.session.applyCounterOperations(a.id, {
            operations: [
              { kind: "delta", operation_id: `${tag}-${a.id}`, delta: a.target!, client_recorded_at: nowIso() },
            ],
          });
      }
    }

    it("counts completed nights, unlocks Level 2 after 7, and applies it from the next session (LEVEL-01, LEVEL-04)", async () => {
      await env.setNow("2026-11-01T02:00:00+07:00");
      const b = await env.onboarded("p1@ngajigaes.test");
      for (let i = 0; i < 7; i++) {
        await env.setNow(new Date(Date.parse("2026-11-01T02:00:00+07:00") + i * DAY).toISOString());
        const s = await b.data().session.ensureActiveSession();
        expect(s.level).toBe(1);
        await completeNight(b, s, `p1-${i}`);
        expect((await b.data().session.getSession(s.id)).state).toBe("completed");
      }
      await env.setNow("2026-11-07T20:00:00+07:00");
      const lp = await b.data().progress.getLevelProgress();
      expect(lp.levels[0]).toMatchObject({ completed: 7, required: 7, unlocked: true });
      expect(lp.levels[1]!.unlocked).toBe(true);
      expect(lp.levels[1]!.effective_from_session_key).toBe("2026-11-08");
      const last = (await b.data().report.getSessionHistory()).sessions[0]!;
      expect(last.session_key).toBe("2026-11-07");
      expect(await b.data().session.getActiveSession()).toBeNull(); // after the cutoff the active key is tomorrow, no row yet
      const ids = await env.db.exec(
        "select id::text as id from public.night_sessions where fajr_local_date = '2026-11-07' and user_id = $1::uuid",
        [await env.userId("p1@ngajigaes.test")],
      );
      const summary = await b.data().session.getSummary(String(ids[0]!.id));
      expect(summary).toMatchObject({
        successful_nights_at_level: 7,
        required_successful_nights: 7,
        next_level_unlocked: true,
      });
      await env.setNow("2026-11-08T02:00:00+07:00");
      const l2 = await b.data().session.ensureActiveSession();
      expect(l2.level).toBe(2);
      expect(l2.activities.length).toBeGreaterThan(14);
      expect(await b.data().progress.getCurrentLevel()).toMatchObject({
        level: 2,
        effective_from_session_key: "2026-11-08",
      });
      await env.setNow("2026-11-12T02:00:00+07:00");
    });

    it("the dashboard, calendar and reports agree, and missed days need no job (PRD §10.4)", async () => {
      await env.setNow("2026-11-05T02:00:00+07:00");
      const b = await env.onboarded("p2@ngajigaes.test");
      const layer = b.data();
      const s = await layer.session.ensureActiveSession();
      await completeNight(b, s, "p2-0");
      await env.setNow("2026-11-10T02:00:00+07:00"); // 5 nights later, nothing in between
      const dash = await layer.report.getDashboard();
      expect(dash.is_demo).toBe(false);
      expect(dash.level).toBe(1);
      expect(dash.status_counts).toEqual({ completed: 1, partial: 0, missed: 4, excused: 0, upcoming: 1 });
      expect(dash.completion_rate).toBe(20);
      expect(dash.calendar_days.map((d) => d.status)).toEqual([
        "completed",
        "missed",
        "missed",
        "missed",
        "missed",
        "upcoming",
      ]);
      expect(dash.current_session).toMatchObject({
        id: null,
        session_key: "2026-11-10",
        status: "upcoming",
        state: "scheduled",
      });
      expect(dash.prayer_time).toMatchObject({
        available: true,
        source: "provider",
        label: "Jadwal terkini",
        demo_note: null,
        fajr_at: "2026-11-09T21:30:00.000Z",
      });
      expect(dash.setup_cards).toEqual([
        { key: "location", done: true },
        { key: "notifications", done: false },
        { key: "install_app", done: false },
      ]);
      const cal = await layer.report.getCalendar("2026-11-07", "2026-11-09");
      expect(cal.days.map((d) => d.date)).toEqual(["2026-11-07", "2026-11-08", "2026-11-09"]);
      const rep = await layer.report.getReport(7);
      expect(rep).toMatchObject({ period: 7, from: "2026-11-05", to: "2026-11-09" });
      expect(rep.status_counts).toEqual({ completed: 1, partial: 0, missed: 4, excused: 0, upcoming: 0 });
      const hist = await layer.report.getSessionHistory();
      expect(hist.sessions).toHaveLength(1);
      expect(hist.sessions[0]).toMatchObject({ status: "completed", level: 1 });
      await env.setNow("2026-11-12T02:00:00+07:00");
    });

    it("rejects any report period but 7, 30 or 90, and a bad calendar date", async () => {
      const b = await env.onboarded("p3@ngajigaes.test");
      for (const q of ["", "?period=14", "?period=abc", "?period=-7"])
        expect((await b.raw(`/me/reports${q}`)).status, q).toBe(400);
      expect((await b.raw("/me/calendar?from=nope")).status).toBe(400);
    });
  });

  describe("excuse", () => {
    it("adds one date and a range, cancels inside the window, and never shows a reason", async () => {
      await env.setNow("2026-11-12T02:00:00+07:00");
      const b = await env.onboarded("x1@ngajigaes.test");
      const layer = b.data();
      expect((await layer.excuse.addExcuse({ from: "2026-11-14" })).excused_dates).toEqual(["2026-11-14"]);
      expect((await layer.excuse.addExcuse({ from: "2026-11-16", to: "2026-11-18" })).excused_dates).toEqual([
        "2026-11-14",
        "2026-11-16",
        "2026-11-17",
        "2026-11-18",
      ]);
      expect((await layer.excuse.cancelExcuse("2026-11-14")).excused_dates).toEqual([
        "2026-11-16",
        "2026-11-17",
        "2026-11-18",
      ]);
      expect((await errorOf(layer.excuse.cancelExcuse("2026-11-14"))).code).toBe("NOT_FOUND");
      expect((await errorOf(layer.excuse.addExcuse({ from: "2026-12-01", to: "2026-12-30" }))).code).toBe(
        "VALIDATION_ERROR",
      );
      expect((await errorOf(layer.excuse.addExcuse({ from: "2026-12-05", to: "2026-12-01" }))).code).toBe(
        "VALIDATION_ERROR",
      );
      const raw = await b.json("/me/excuse", "POST", { from: "2026-11-25", reason: "sakit", category: "health" });
      expect(JSON.stringify(await raw.json())).not.toMatch(/sakit|health|reason/);
      expect(JSON.stringify(await env.db.exec("select * from public.session_excuses"))).not.toMatch(/sakit|health/);
    });

    it("cannot be cancelled after the correction window, and excused nights leave the completion rate alone", async () => {
      await env.setNow("2026-11-12T02:00:00+07:00");
      const b = await env.onboarded("x2@ngajigaes.test");
      const layer = b.data();
      await layer.excuse.addExcuse({ from: "2026-11-12" });
      const early = await layer.report.getDashboard();
      expect(early.status_counts).toEqual({ completed: 0, partial: 0, missed: 0, excused: 1, upcoming: 0 });
      expect(early.completion_rate).toBeNull(); // nothing but excused: "Belum ada data", never 0%
      await env.setNow("2026-11-14T12:30:00+07:00"); // 48h after the 11-12 12:00 cutoff
      expect((await errorOf(layer.excuse.cancelExcuse("2026-11-12"))).code).toBe("SESSION_LOCKED");
      const d = await layer.report.getDashboard();
      expect(d.status_counts.excused).toBe(1);
      expect(d.completion_rate).toBe(0); // the two nights after it were missed
      await env.setNow("2026-11-12T02:00:00+07:00");
    });
  });

  describe("profile, location, onboarding, preferences", () => {
    it("lists the regions, sets one, and reads the schedule for it", async () => {
      const b = await env.onboarded("f1@ngajigaes.test");
      const layer = b.data();
      const regions = await layer.prayer.listRegions();
      expect(regions.length).toBeGreaterThanOrEqual(3);
      const mks = regions.find((r) => r.name.startsWith("Makassar"))!;
      const pt = await layer.prayer.setLocation({ mode: "region", region_id: mks.id });
      expect(pt).toMatchObject({ region_id: mks.id, timezone: "Asia/Makassar", available: false }); // the demo seed has times for Jakarta only
      expect((await layer.profile.getProfile()).region_id).toBe(mks.id);
      const jkt = regions.find((r) => r.name.startsWith("Jakarta"))!;
      expect(await layer.prayer.setLocation({ mode: "region", region_id: jkt.id })).toMatchObject({
        available: true,
        label: "Jadwal terkini",
      });
    });

    it("manual schedule: labelled 'Diatur manual', in the user's zone", async () => {
      const b = await env.onboarded("f2@ngajigaes.test");
      const pt = await b
        .data()
        .profile.setLocation({ mode: "manual", timezone: "Asia/Jayapura", fajr_time: "04:10", maghrib_time: "17:40" });
      expect(pt).toMatchObject({
        available: true,
        source: "manual",
        label: "Diatur manual",
        timezone: "Asia/Jayapura",
        fajr_at: "2026-11-11T19:10:00.000Z",
      });
      expect(await b.data().prayer.getNextFajr()).toEqual(pt);
      expect(await b.data().profile.getProfile()).toMatchObject({
        schedule_mode: "manual",
        region_id: null,
        timezone: "Asia/Jayapura",
      });
    });

    it("says 'not available' when there is no schedule, instead of inventing one (BUG-04)", async () => {
      await env.setNow("2027-06-01T02:00:00+07:00");
      const b = await env.onboarded("f3@ngajigaes.test");
      const pt = await b.data().prayer.getNextFajr();
      expect(pt).toMatchObject({ available: false, fajr_at: null, source: null, label: null, cache_status: "none" });
      const wake = await b.data().prayer.getWakePlan();
      expect(wake).toMatchObject({ wake_at: null, fajr_at: null, level: 1 });
      await env.setNow("2026-11-12T02:00:00+07:00");
    });

    it("plans the wake-up from Fajr, the level and the bedtime (PRD §14.6)", async () => {
      const b = await env.onboarded("f4@ngajigaes.test");
      const w = await b.data().prayer.getWakePlan();
      // Fajr 04:30 WIB - 60 min Level 1 - 10 min buffer = 03:20 WIB
      expect(w).toMatchObject({
        level: 1,
        wake_at: "2026-11-11T20:20:00.000Z",
        duration_minutes: 60,
        buffer_minutes: 10,
        source: "provider",
      });
      expect(w.sleep_hours).toBeCloseTo(5.33, 1); // from the default 22:00 bedtime
      await b
        .data()
        .notifications.putPreferences({
          ...(await b.data().notifications.getPreferences()),
          bedtime: { enabled: true, target_sleep_time: "23:30", offset_minutes: 30 },
        });
      const late = await b.data().prayer.getWakePlan();
      expect(late.sleep_warning).toContain("jam tidur");
    });

    it("profile: name, display preferences, onboarding once", async () => {
      const b = await env.onboarded("f5@ngajigaes.test");
      const layer = b.data();
      const start = (await layer.profile.getProfile()).program_start_date;
      expect(start).toBe("2026-11-12");
      expect((await layer.profile.updateProfile({ display_name: "  Zen " })).display_name).toBe("Zen");
      expect(await layer.profile.updatePreferences({ theme_pref: "dark", dhikr_font_size: 30 })).toMatchObject({
        theme_pref: "dark",
        dhikr_font_size: 30,
        quran_font_size: 30,
      });
      expect((await errorOf(layer.profile.updatePreferences({ quran_font_size: 99 }))).code).toBe("VALIDATION_ERROR");
      await env.setNow("2026-11-20T02:00:00+07:00");
      expect((await layer.profile.completeOnboarding()).program_start_date).toBe(start);
      await env.setNow("2026-11-12T02:00:00+07:00");
    });

    it("onboarding without a location says so", async () => {
      await env.grant("f6@ngajigaes.test");
      const b = await env.signIn("f6@ngajigaes.test");
      const e = await errorOf(b.data().profile.completeOnboarding());
      expect(e).toMatchObject({ code: "VALIDATION_ERROR", details: { reason: "LOCATION_REQUIRED" } });
    });

    it("Qur'an position and notification preferences round trip", async () => {
      const b = await env.onboarded("f7@ngajigaes.test");
      const layer = b.data();
      expect(await layer.quran.getProgress()).toEqual([]);
      const p = await layer.quran.putProgress(18, { ayah: 25 });
      expect(p).toMatchObject({ surah: 18, ayah: 25 });
      await layer.quran.putProgress(36, { ayah: null });
      expect((await layer.quran.getProgress()).map((x) => [x.surah, x.ayah])).toEqual([
        [18, 25],
        [36, null],
      ]);
      expect((await errorOf(layer.quran.putProgress(200, { ayah: 1 }))).code).toBe("NOT_FOUND");
      const prefs = await layer.notifications.getPreferences();
      expect(prefs.bedtime).toEqual({ enabled: true, target_sleep_time: "22:00", offset_minutes: 30 });
      const saved = await layer.notifications.putPreferences({
        ...prefs,
        fajr: { enabled: false },
        quiet_hours: { enabled: true, start: "23:00", end: "03:00", allow_worship: false },
      });
      expect(saved.fajr.enabled).toBe(false);
      expect(await layer.notifications.getPreferences()).toEqual(saved);
    });
  });
});
