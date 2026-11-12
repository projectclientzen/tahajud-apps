import amalan from "@content/amalan.v1.json";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ApiError,
  accessSchema,
  calendarResponseSchema,
  counterOperationsResponseSchema,
  dashboardSchema,
  levelProgressResponseSchema,
  nightSessionSchema,
  prayerTimeSchema,
  reportResponseSchema,
  sessionHistoryResponseSchema,
  sessionSummarySchema,
  wakePlanSchema,
} from "@/data/contracts";
import { createDataLayer, resolveDataMode, SCENARIOS, type ScenarioName } from "@/data";
import { createMockDataLayer, type MockDataLayer } from "@/data/mock";
import { memoryStorage } from "@/data/mock/storage";
import { wib } from "../domain/helpers";

let n = 0;
const uuid = () => `op-${++n}`;

function make(scenario: ScenarioName, at = "2026-11-12 08:00", userId = "demo-user"): MockDataLayer {
  return createMockDataLayer({ userId, scenario, storage: memoryStorage(), clock: { now: () => wib(at) } });
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "no-error";
  } catch (e) {
    return e instanceof ApiError ? e.code : `other:${String(e)}`;
  }
}

/** Complete every activity of the active session through the public repository API. */
async function completeActive(layer: MockDataLayer) {
  const sess = await layer.session.ensureActiveSession();
  for (const a of sess.activities) {
    if (a.kind === "checklist") {
      await layer.session.setChecklist(a.id, { checked: true, version: a.version });
    } else {
      await layer.session.applyCounterOperations(a.id, {
        operations: [
          {
            kind: "delta",
            operation_id: uuid(),
            delta: a.target ?? 1,
            client_recorded_at: layer.dev.now().toISOString(),
          },
        ],
      });
    }
  }
  return layer.session.getSession(sess.id);
}

/** Find an activity by its content id ("night:istighfar"). API ids are prefixed with the session key. */
function act<T extends { id: string }>(s: { activities: T[] }, contentId: string): T {
  const a = s.activities.find((x) => x.id.endsWith(`~${contentId}`));
  if (!a) throw new Error(`no activity ${contentId}`);
  return a;
}

const advanceToNextMorning = async (layer: MockDataLayer) => {
  const next = new Date(layer.dev.now().getTime() + 24 * 3_600_000);
  await layer.dev.setNow(next.toISOString());
};

describe("mock data layer: scenarios", () => {
  it.each([...SCENARIOS])("%s builds and every response matches its contract schema", async (name) => {
    const l = make(name);
    expect(accessSchema.parse(await l.access.getAccess())).toBeTruthy();
    if ((await l.access.getAccess()).access_status !== "active") {
      expect(await code(l.report.getDashboard())).toBe("ENTITLEMENT_INACTIVE");
      return;
    }
    expect(dashboardSchema.parse(await l.report.getDashboard()).is_demo).toBe(true);
    levelProgressResponseSchema.parse(await l.progress.getLevelProgress());
    reportResponseSchema.parse(await l.report.getReport(30));
    calendarResponseSchema.parse(await l.report.getCalendar());
    sessionHistoryResponseSchema.parse(await l.report.getSessionHistory());
    prayerTimeSchema.parse(await l.prayer.getNextFajr());
    wakePlanSchema.parse(await l.prayer.getWakePlan());
    const s = nightSessionSchema.parse(await l.session.ensureActiveSession());
    sessionSummarySchema.parse(await l.session.getSummary(s.id));
  });

  it("LEVEL-01 new_account: Level 1 active, Level 2-3 locked, REPORT-02 empty state", async () => {
    const d = await make("new_account").report.getDashboard();
    expect(d.level).toBe(1);
    expect(d.level_progress.levels.map((l) => l.unlocked)).toEqual([true, false, false]);
    expect(d.completion_rate).toBeNull();
    expect(d.insight).toBeNull();
    expect(d.current_session).toMatchObject({ id: null, status: "upcoming", state: "scheduled" });
    expect(d.status_counts).toMatchObject({ completed: 0, missed: 0, upcoming: 1 });
  });

  it("five_nights_completed: progress 5/7 and 100% rate", async () => {
    const d = await make("five_nights_completed").report.getDashboard();
    expect(d.level_progress.levels[0]).toMatchObject({ completed: 5, required: 7, unlocked: true });
    expect(d.completion_rate).toBe(100);
    expect(d.insight).toBeNull(); // 5/7 is neither halfway (4) nor one away (6), and fewer than 7 closed days
  });

  it("level2_active: Level 2 is current, yesterday is partial, Level 3 locked", async () => {
    const l = make("level2_active");
    const d = await l.report.getDashboard();
    expect(d.level).toBe(2);
    expect(d.level_progress.levels.map((x) => [x.completed, x.unlocked])).toEqual([
      [7, true],
      [1, true],
      [0, false],
    ]);
    expect(d.status_counts).toMatchObject({ completed: 8, partial: 1 });
    const warn = await l.prayer.getWakePlan();
    expect(warn.level).toBe(2);
    expect(warn.sleep_warning).toMatch(/^Jadwalmu menyisakan sekitar 4 jam tidur/);
  });

  it("offline: counter operations fail with OFFLINE, reads still work", async () => {
    const l = make("offline");
    const s = await l.session.ensureActiveSession();
    const counter = s.activities.find((a) => a.kind === "counter")!;
    const req = {
      operations: [
        { kind: "delta" as const, operation_id: uuid(), delta: 1, client_recorded_at: l.dev.now().toISOString() },
      ],
    };
    expect(await code(l.session.applyCounterOperations(counter.id, req))).toBe("OFFLINE");
    await l.dev.setOffline(false);
    expect((await l.session.applyCounterOperations(counter.id, req)).results[0]!.status).toBe("accepted");
  });

  it("stale_schedule: provider down and cache expired shows no fajr time, never a fake verified one", async () => {
    const l = make("stale_schedule");
    const p = await l.prayer.getNextFajr();
    expect(p).toMatchObject({ available: false, fajr_at: null, label: null, cache_status: "none" });
    expect((await l.prayer.getWakePlan()).wake_at).toBeNull();
    await l.dev.setProviderDown(false);
    expect(await l.prayer.getNextFajr()).toMatchObject({ available: true, label: "Jadwal terkini" });
  });

  it("provider down with a valid cache labels it 'Jadwal tersimpan'", async () => {
    const l = make("five_nights_completed");
    await l.dev.setProviderDown(true);
    expect(await l.prayer.getNextFajr()).toMatchObject({
      available: true,
      label: "Jadwal tersimpan",
      cache_status: "cached",
      source: "cached",
    });
  });

  it("purchase_pending: access endpoint answers, everything else is blocked", async () => {
    const l = make("purchase_pending");
    expect(await l.access.getAccess()).toMatchObject({
      access_status: "awaiting_order_verification",
      onboarding_completed: false,
    });
    expect(await code(l.session.ensureActiveSession())).toBe("ENTITLEMENT_INACTIVE");
    expect(await code(l.report.getReport(7))).toBe("ENTITLEMENT_INACTIVE");
  });

  it("PRAYER-03 manual_schedule: 'Diatur manual', no demo note, planner works", async () => {
    const l = make("manual_schedule");
    const p = await l.prayer.getNextFajr();
    expect(p).toMatchObject({
      available: true,
      source: "manual",
      label: "Diatur manual",
      timezone: "Asia/Riyadh",
      demo_note: null,
      maghrib_at: null,
    });
    const w = await l.prayer.getWakePlan();
    expect(w.source).toBe("manual");
    expect(w.wake_at).not.toBeNull();
    expect((await l.report.getDashboard()).prayer_time.label).toBe("Diatur manual");
  });

  it("labels demo schedules as not from Kemenag", async () => {
    const p = await make("new_account").prayer.getNextFajr();
    expect(p.demo_note).toBe("Jadwal contoh, bukan dari Kemenag");
  });
});

describe("mock data layer: night session", () => {
  it("ensureActiveSession is idempotent and freezes level, zone, content version", async () => {
    const l = make("new_account");
    expect(await l.session.getActiveSession()).toBeNull();
    const a = await l.session.ensureActiveSession();
    const b = await l.session.ensureActiveSession();
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({
      session_key: "2026-11-12",
      level: 1,
      timezone: "Asia/Jakarta",
      content_version: "1.1.0",
      status: "upcoming",
      state: "scheduled",
    });
    expect((await l.session.getActiveSession())!.id).toBe(a.id);
  });

  it("serves owner Arabic text unchanged and never invents transliteration", async () => {
    const s = await make("new_account").session.ensureActiveSession();
    const raw = amalan.dhikr as Record<string, { arabic_text: string }>;
    const istighfar = act(s, "night:istighfar");
    expect(istighfar.arabic_text).toBe(raw.istighfar!.arabic_text);
    expect(istighfar.dhikr_review_status).toBe("published");
    expect(act(s, "night:salat_taubat").arabic_text).toBeNull();
    expect(s.activities.filter((a) => a.phase === "post_fajr").length).toBeGreaterThan(5);
  });

  it("SESSION-01 an activity logged at 23.50 and one at 00.20 land in the same session", async () => {
    const l = make("new_account", "2026-11-12 23:50");
    const s1 = await l.session.ensureActiveSession();
    await l.dev.setNow(wib("2026-11-13 00:20").toISOString());
    const s2 = await l.session.ensureActiveSession();
    expect(s2.id).toBe(s1.id);
    expect(s2.session_key).toBe("2026-11-13");
  });

  it("SESSION-03 flips to the next session at 12.00", async () => {
    const l = make("new_account", "2026-11-13 11:59");
    expect((await l.session.ensureActiveSession()).session_key).toBe("2026-11-13");
    await l.dev.setNow(wib("2026-11-13 12:01").toISOString());
    expect((await l.session.ensureActiveSession()).session_key).toBe("2026-11-14");
  });

  it("DZIKIR-03 resending an operation id does not double count; status follows the data", async () => {
    const l = make("new_account");
    const s = await l.session.ensureActiveSession();
    const c = act(s, "night:istighfar");
    const op = {
      kind: "delta" as const,
      operation_id: "same-op",
      delta: 20,
      client_recorded_at: l.dev.now().toISOString(),
    };
    const r1 = await l.session.applyCounterOperations(c.id, { operations: [op] });
    const r2 = await l.session.applyCounterOperations(c.id, { operations: [op] });
    counterOperationsResponseSchema.parse(r1);
    expect(r1.results[0]).toMatchObject({ status: "accepted", authoritative_count: 20, target: 100, completed: false });
    expect(r2.results[0]).toMatchObject({ status: "duplicate", authoritative_count: 20 });
    expect((await l.session.getSession(s.id)).state).toBe("in_progress");
  });

  it("BUG-06 completing every required activity completes the session; summary does not change status", async () => {
    const l = make("new_account");
    const done = await completeActive(l);
    expect(done).toMatchObject({ state: "completed", status: "completed" });
    const sum = await l.session.getSummary(done.id);
    expect(sum).toMatchObject({
      session_status: "completed",
      successful_nights_at_level: 1,
      required_successful_nights: 7,
      current_level: 1,
      next_level_unlocked: false,
    });
    expect((await l.session.getSession(done.id)).status).toBe("completed");
  });

  it("optional items do not block completion", async () => {
    const l = make("new_account");
    const s = await l.session.ensureActiveSession();
    for (const a of s.activities.filter((x) => x.required)) {
      if (a.kind === "checklist") await l.session.setChecklist(a.id, { checked: true, version: a.version });
      else
        await l.session.applyCounterOperations(a.id, {
          operations: [
            { kind: "delta", operation_id: uuid(), delta: a.target!, client_recorded_at: l.dev.now().toISOString() },
          ],
        });
    }
    expect((await l.session.getSession(s.id)).state).toBe("completed");
  });

  it("checklist uses optimistic concurrency", async () => {
    const l = make("new_account");
    const s = await l.session.ensureActiveSession();
    const a = act(s, "night:doa");
    await l.session.setChecklist(a.id, { checked: true, version: 0 });
    try {
      await l.session.setChecklist(a.id, { checked: false, version: 0 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe("VERSION_CONFLICT");
      expect((e as ApiError).details).toEqual({ server: { checked: true, version: 1 } });
    }
    expect(
      await code(
        l.session.setChecklist(s.activities.find((x) => x.kind === "counter")!.id, { checked: true, version: 0 }),
      ),
    ).toBe("VALIDATION_ERROR");
    expect(await code(l.session.setChecklist("2026-11-12~night:nope", { checked: true, version: 0 }))).toBe(
      "NOT_FOUND",
    );
    expect(await code(l.session.setChecklist("garbage", { checked: true, version: 0 }))).toBe("NOT_FOUND");
  });

  it("rejects writes after the 48 hour correction window with SESSION_LOCKED", async () => {
    const l = make("new_account");
    const s = await l.session.ensureActiveSession();
    const check = act(s, "night:doa");
    const counter = act(s, "night:istighfar");
    expect(s.correction_window_open).toBe(true);
    await l.dev.setNow(wib("2026-11-15 12:01").toISOString()); // cutoff 11-12 12:00 + 48 h = 11-14 12:00 for 11-12 key? key is 11-12 -> deadline 11-14 12:00
    expect((await l.session.getSession(s.id)).correction_window_open).toBe(false);
    expect(await code(l.session.setChecklist(check.id, { checked: true, version: 0 }))).toBe("SESSION_LOCKED");
    const r = await l.session.applyCounterOperations(counter.id, {
      operations: [{ kind: "delta", operation_id: uuid(), delta: 1, client_recorded_at: l.dev.now().toISOString() }],
    });
    expect(r.results[0]).toMatchObject({ status: "rejected", error_code: "SESSION_LOCKED", authoritative_count: 0 });
  });

  it("validates request shape (51 operations, bad delta)", async () => {
    const l = make("new_account");
    const s = await l.session.ensureActiveSession();
    const c = s.activities.find((a) => a.kind === "counter")!;
    const ops = Array.from({ length: 51 }, () => ({
      kind: "delta" as const,
      operation_id: uuid(),
      delta: 1,
      client_recorded_at: l.dev.now().toISOString(),
    }));
    await expect(l.session.applyCounterOperations(c.id, { operations: ops })).rejects.toThrow();
    await expect(
      l.session.applyCounterOperations(c.id, { operations: [{ ...ops[0]!, delta: 5000 }] }),
    ).rejects.toThrow();
  });

  it("DZIKIR-04/05 through the API: batches from two devices sum to 60", async () => {
    const l = make("new_account");
    const s = await l.session.ensureActiveSession();
    const c = act(s, "night:istighfar");
    const mk = (delta: number) => ({
      kind: "delta" as const,
      operation_id: uuid(),
      delta,
      client_recorded_at: l.dev.now().toISOString(),
    });
    await l.session.applyCounterOperations(c.id, { operations: [mk(10), mk(10), mk(10)] }); // device A
    const r = await l.session.applyCounterOperations(c.id, { operations: [mk(15), mk(15)] }); // device B
    expect(r.results.at(-1)!.authoritative_count).toBe(60);
    const set0 = await l.session.applyCounterOperations(c.id, {
      operations: [{ kind: "set_zero", operation_id: uuid(), client_recorded_at: l.dev.now().toISOString() }],
    });
    expect(set0.results[0]!.authoritative_count).toBe(0);
  });
});

describe("mock data layer: progression over time", () => {
  it("LEVEL-03/04, SESSION-05: 7 completed nights unlock Level 2 from the next session and a correction cannot relock it", async () => {
    const l = make("new_account", "2026-11-12 08:00");
    for (let i = 0; i < 7; i++) {
      const done = await completeActive(l);
      expect(done.level).toBe(1);
      if (i < 6) await advanceToNextMorning(l);
      else {
        // 7th night just completed, still inside session 2026-11-18
        const p = await l.progress.getLevelProgress();
        expect(p.levels[0]).toMatchObject({ completed: 7, ratio: 1 });
        expect(p.levels[1]).toMatchObject({ unlocked: true, effective_from_session_key: "2026-11-19" });
        expect(p.current_level).toBe(1); // LEVEL-04: running session unchanged
        expect(done.activities.length).toBe((await l.session.getSession(done.id)).activities.length);
        expect(await l.progress.getCurrentLevel()).toMatchObject({ level: 1 });
        expect((await l.session.getSummary(done.id)).next_level_effective_session_key).toBe("2026-11-19");
      }
    }
    await advanceToNextMorning(l);
    const next = await l.session.ensureActiveSession();
    expect(next).toMatchObject({ session_key: "2026-11-19", level: 2 });
    expect(next.activities.some((a) => a.id.endsWith("~night:hasbunallah"))).toBe(true);
    // correction: untick a checklist of the 7th session (inside its window) -> completed count drops, Level 2 stays
    const seventh = await l.session.getSession("sess_2026-11-18");
    const doa = act(seventh, "night:doa");
    await l.session.setChecklist(doa.id, { checked: false, version: doa.version });
    const p = await l.progress.getLevelProgress();
    expect(p.levels[0]!.completed).toBe(6);
    expect(p.levels[1]!.unlocked).toBe(true);
    expect((await l.session.ensureActiveSession()).level).toBe(2);
  });

  it("SESSION-06 / LEVEL-02: 3 unopened nights are missed and count in the rate; progress does not drop", async () => {
    const l = make("five_nights_completed", "2026-11-12 08:00");
    await l.dev.setNow(wib("2026-11-15 08:00").toISOString());
    const d = await l.report.getDashboard();
    expect(d.status_counts).toMatchObject({ completed: 5, missed: 3, upcoming: 1 });
    expect(d.completion_rate).toBe(62.5);
    expect(d.level_progress.levels[0]!.completed).toBe(5);
    const cal = await l.report.getCalendar("2026-11-12", "2026-11-14");
    expect(cal.days.map((x) => x.status)).toEqual(["missed", "missed", "missed"]);
  });

  it("SESSION-02 excused nights stay out of the rate; range max 15 days; cancel only inside the window", async () => {
    const l = make("five_nights_completed", "2026-11-12 08:00");
    await l.dev.setNow(wib("2026-11-15 08:00").toISOString());
    const r = await l.excuse.addExcuse({ from: "2026-11-12", to: "2026-11-14" });
    expect(r.excused_dates).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
    const d = await l.report.getDashboard();
    expect(d.status_counts).toMatchObject({ completed: 5, missed: 0, excused: 3 });
    expect(d.completion_rate).toBe(100);
    expect(await code(l.excuse.addExcuse({ from: "2026-11-20", to: "2026-12-10" }))).toBe("VALIDATION_ERROR");
    expect((await l.excuse.cancelExcuse("2026-11-14")).excused_dates).toEqual(["2026-11-12", "2026-11-13"]);
    expect(await code(l.excuse.cancelExcuse("2026-11-12"))).toBe("SESSION_LOCKED");
    expect(await code(l.excuse.cancelExcuse("2026-01-01"))).toBe("NOT_FOUND");
  });

  it("excused session still records dhikr in activity stats without changing status", async () => {
    const l = make("new_account");
    await l.excuse.addExcuse({ from: "2026-11-12" });
    const s = await l.session.ensureActiveSession();
    const c = act(s, "night:istighfar");
    await l.session.applyCounterOperations(c.id, {
      operations: [{ kind: "delta", operation_id: uuid(), delta: 100, client_recorded_at: l.dev.now().toISOString() }],
    });
    expect((await l.session.getSession(s.id)).state).toBe("excused");
    const d = await l.report.getDashboard();
    expect(d.activity_statistics.find((x) => x.id === "night:istighfar")).toMatchObject({
      total_count: 100,
      times_completed: 1,
    });
    expect(d.current_session).toMatchObject({ state: "excused", status: "excused" });
    expect((await make("new_account").report.getDashboard()).current_session?.state).toBe("scheduled");
  });

  it("REPORT-01 style: filters 7 days and reports activity stats", async () => {
    const l = make("level2_active");
    const r = await l.report.getReport(7);
    reportResponseSchema.parse(r);
    expect(r.status_counts).toMatchObject({ completed: 6, partial: 1 });
    expect(r.completion_rate).toBe(85.71);
    expect(r.activity_statistics.find((x) => x.id === "night:istighfar")!.sessions).toBe(7);
    const hist = await l.report.getSessionHistory();
    expect(hist.sessions[0]).toMatchObject({ session_key: "2026-11-11", status: "partial" });
    expect(hist.sessions[0]!.required_done).toBeLessThan(hist.sessions[0]!.required_total);
  });

  it("SESSION-04 changing region mid-session keeps the old session zone; the next session uses the new one", async () => {
    const l = make("new_account", "2026-11-12 23:00");
    const first = await l.session.ensureActiveSession();
    expect(first.timezone).toBe("Asia/Jakarta");
    const p = await l.prayer.setLocation({ mode: "region", region_id: "demo-makassar" });
    expect(p).toMatchObject({ timezone: "Asia/Makassar", region_id: "demo-makassar" });
    expect((await l.session.getSession(first.id)).timezone).toBe("Asia/Jakarta");
    expect((await l.session.getSession(first.id)).cutoff_at).toBe("2026-11-13T05:00:00.000Z");
    await l.dev.setNow(wib("2026-11-13 13:30").toISOString()); // 14:30 WITA: past WITA cutoff
    const next = await l.session.ensureActiveSession();
    expect(next).toMatchObject({ session_key: "2026-11-14", timezone: "Asia/Makassar", region_id: "demo-makassar" });
    expect(await code(l.prayer.setLocation({ mode: "region", region_id: "nope" }))).toBe("NOT_FOUND");
    const manual = await l.prayer.setLocation({ mode: "manual", timezone: "Asia/Riyadh", fajr_time: "04:10" });
    expect(manual).toMatchObject({ label: "Diatur manual", timezone: "Asia/Riyadh" });
  });

  it("lists regions and exposes the Al-Kahfi window on Thursday", async () => {
    const l = make("new_account", "2026-11-12 10:00"); // Thursday
    expect((await l.prayer.listRegions()).map((r) => r.timezone)).toEqual([
      "Asia/Jakarta",
      "Asia/Makassar",
      "Asia/Jayapura",
    ]);
    const w = await l.engine.getAlKahfiWindow();
    expect(w).not.toBeNull();
    expect(w!.usedFallback).toBe(false);
  });

  it("stores Qur'an reading position only, for supported surahs", async () => {
    const l = make("new_account");
    expect(await l.quran.getProgress()).toEqual([]);
    const p = await l.quran.putProgress(18, { ayah: 10 });
    expect(p).toMatchObject({ surah: 18, ayah: 10 });
    expect(await l.quran.getProgress()).toHaveLength(1);
    expect(await code(l.quran.putProgress(2, { ayah: 1 }))).toBe("NOT_FOUND");
    expect(Object.keys(p)).not.toContain("text");
  });

  it("validates and saves notification preferences", async () => {
    const l = make("new_account");
    const prefs = await l.notifications.getPreferences();
    const saved = await l.notifications.putPreferences({ ...prefs, bedtime: { ...prefs.bedtime, enabled: false } });
    expect(saved.bedtime.enabled).toBe(false);
    expect((await l.notifications.getPreferences()).bedtime.enabled).toBe(false);
    await expect(
      l.notifications.putPreferences({ ...prefs, bedtime: { ...prefs.bedtime, target_sleep_time: "late" } }),
    ).rejects.toThrow();
  });

  it("dev tools: advance, reset and scenario switch keep the frozen clock", async () => {
    const l = make("new_account", "2026-11-12 08:00");
    await l.dev.setNow(wib("2026-11-12 08:00").toISOString());
    await l.dev.advance(5 * 3_600_000);
    expect(l.dev.now().toISOString()).toBe(wib("2026-11-12 13:00").toISOString());
    await l.dev.loadScenario("five_nights_completed");
    expect(l.dev.now().toISOString()).toBe(wib("2026-11-12 13:00").toISOString());
    expect((await l.dev.snapshot()).scenario).toBe("five_nights_completed");
    await l.dev.reset();
    expect((await l.dev.snapshot()).scenario).toBe("new_account");
    await l.dev.setNow(null);
  });
});

describe("data layer selection", () => {
  it("resolves mode from env value: only 'live' is live", () => {
    expect(resolveDataMode("live")).toBe("live");
    expect(resolveDataMode("mock")).toBe("mock");
    expect(resolveDataMode(undefined)).toBe("mock");
    expect(resolveDataMode("production")).toBe("mock");
  });
  it("live mode calls /api/v1: with no server in reach it fails as OFFLINE, never with made-up data (T3b)", async () => {
    const live = createDataLayer({ userId: "u", mode: "live" });
    expect(live.mode).toBe("live");
    const err = await live.session.getActiveSession().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("OFFLINE");
    expect(JSON.stringify((err as ApiError).toJSON())).toContain("OFFLINE");
    expect(await Promise.resolve(live.report)).toBe(live.report);
  });
  it("mock mode returns the mock layer", () => {
    expect(createDataLayer({ userId: "u", mode: "mock", storage: memoryStorage() }).mode).toBe("mock");
  });
});

describe("fixtures", () => {
  it("every fixture file starts with the DEMO DATA header", () => {
    const dir = "src/data/mock/fixtures";
    for (const f of readdirSync(dir)) {
      expect(readFileSync(`${dir}/${f}`, "utf8").startsWith("// DEMO DATA: bukan data asli"), f).toBe(true);
    }
  });
  it("uses only the demo user name and no real people", () => {
    const src = readFileSync("src/data/mock/fixtures/scenarios.ts", "utf8");
    expect(src).toContain("Pengguna Demo");
  });
});
