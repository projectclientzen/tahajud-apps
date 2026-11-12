import { describe, expect, it } from "vitest";
import { buildCalendar, type CalendarDay } from "@/domain/calendar/calendar";
import { addExcuse, cancelExcuse, normalizeExcused } from "@/domain/calendar/excuse";
import {
  checkUnlock,
  completedAtLevel,
  computeLevelProgress,
  initialLevelState,
  isUnlocked,
  levelForSession,
  type SessionOutcome,
} from "@/domain/progression/progression";
import { activityStats, completionRate, selectPeriod, statusCounts } from "@/domain/reporting/reports";
import { pickInsight } from "@/domain/reporting/insight";
import { addDays } from "@/domain/time/tz";
import { record, wib } from "./helpers";

const day = (date: string, status: CalendarDay["status"]): CalendarDay => ({
  date,
  status,
  level: 1,
  hasProgress: status !== "missed",
});
const seq = (start: string, statuses: CalendarDay["status"][]): CalendarDay[] =>
  statuses.map((s, i) => day(addDays(start, i), s));

describe("calendar", () => {
  it("SESSION-06 shows 3 unopened nights as missed and counts them in the rate", () => {
    const days = buildCalendar({
      programStartDate: "2026-11-01",
      activeKey: "2026-11-05",
      records: [record("2026-11-01", 1, "all")],
      excusedDates: [],
    });
    expect(days.map((d) => d.status)).toEqual(["completed", "missed", "missed", "missed", "upcoming"]);
    expect(statusCounts(days)).toMatchObject({ completed: 1, missed: 3, upcoming: 1 });
    expect(completionRate(days)).toBe(25);
  });
  it("derives partial from a row with progress and missed from a row without", () => {
    const days = buildCalendar({
      programStartDate: "2026-11-01",
      activeKey: "2026-11-04",
      records: [record("2026-11-01", 1, "some"), record("2026-11-02", 1, "none")],
      excusedDates: [],
    });
    expect(days.map((d) => d.status)).toEqual(["partial", "missed", "missed", "upcoming"]);
    expect(days[0]).toMatchObject({ level: 1, hasProgress: true });
    expect(days[2]).toMatchObject({ level: null, hasProgress: false });
  });
  it("starts at program_start_date and returns nothing before it", () => {
    expect(
      buildCalendar({ programStartDate: "2026-11-10", activeKey: "2026-11-08", records: [], excusedDates: [] }),
    ).toEqual([]);
    const one = buildCalendar({
      programStartDate: "2026-11-10",
      activeKey: "2026-11-10",
      records: [],
      excusedDates: [],
    });
    expect(one.map((d) => d.status)).toEqual(["upcoming"]);
  });
  it("clamps with from/to", () => {
    const days = buildCalendar({
      programStartDate: "2026-11-01",
      activeKey: "2026-11-10",
      records: [],
      excusedDates: [],
      from: "2026-11-03",
      to: "2026-11-05",
    });
    expect(days.map((d) => d.date)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
  });
  it("SESSION-02 excused nights are not missed, not in the rate, and dhikr is still in activity stats", () => {
    const rec = record("2026-11-02", 1, "all");
    const days = buildCalendar({
      programStartDate: "2026-11-01",
      activeKey: "2026-11-04",
      records: [record("2026-11-01", 1, "all"), rec],
      excusedDates: ["2026-11-02", "2026-11-03"],
    });
    expect(days.map((d) => d.status)).toEqual(["completed", "excused", "excused", "upcoming"]);
    expect(completionRate(days)).toBe(100);
    const stats = activityStats([rec]);
    expect(stats.find((s) => s.id === "night:istighfar")).toMatchObject({ timesCompleted: 1, totalCount: 100 });
  });
});

describe("excuse", () => {
  it("adds a single date and a range up to 15 days", () => {
    expect(addExcuse([], "2026-11-05", undefined)).toEqual({ ok: true, dates: ["2026-11-05"] });
    const r = addExcuse(["2026-11-01"], "2026-11-05", "2026-11-19");
    expect(r.ok && r.dates.length).toBe(16);
    expect(addExcuse([], "2026-11-05", "2026-11-19")).toMatchObject({ ok: true });
  });
  it("rejects ranges over 15 days, reversed ranges and bad dates", () => {
    expect(addExcuse([], "2026-11-01", "2026-11-16")).toEqual({ ok: false, error: "range_too_long" });
    expect(addExcuse([], "2026-11-05", "2026-11-01")).toEqual({ ok: false, error: "invalid_range" });
    expect(addExcuse([], "nope", undefined)).toEqual({ ok: false, error: "invalid_date" });
  });
  it("cancels only inside the correction window", () => {
    const list = ["2026-11-10"];
    expect(cancelExcuse(list, "2026-11-10", wib("2026-11-11 10:00"), "Asia/Jakarta")).toEqual({ ok: true, dates: [] });
    expect(cancelExcuse(list, "2026-11-10", wib("2026-11-13 00:00"), "Asia/Jakarta")).toEqual({
      ok: false,
      error: "window_closed",
    });
    expect(cancelExcuse(list, "2026-11-09", wib("2026-11-11 10:00"), "Asia/Jakarta")).toEqual({
      ok: false,
      error: "not_excused",
    });
    expect(normalizeExcused(["2026-11-02", "2026-11-01", "2026-11-02"])).toEqual(["2026-11-01", "2026-11-02"]);
  });
});

const outcomes = (level: 1 | 2 | 3, start: string, statuses: SessionOutcome["status"][]): SessionOutcome[] =>
  statuses.map((status, i) => ({ sessionKey: addDays(start, i), level, status }));

describe("progression", () => {
  const start = "2026-11-01";
  const fresh = () => initialLevelState(start, wib("2026-10-31 20:00"));

  it("LEVEL-01 new account: Level 1 active, Level 2-3 locked", () => {
    const s = fresh();
    const p = computeLevelProgress([], s);
    expect(s.currentLevel).toBe(1);
    expect(p.levels.map((l) => l.unlocked)).toEqual([true, false, false]);
    expect(p.levels.map((l) => l.completed)).toEqual([0, 0, 0]);
    expect(p.levels.map((l) => l.required)).toEqual([7, 12, 20]);
    expect(p.journeyCompleted).toBe(false);
  });
  it("LEVEL-02 a missed night leaves progress at 5", () => {
    const o = [...outcomes(1, start, ["completed", "completed", "completed", "completed", "completed", "missed"])];
    expect(computeLevelProgress(o, fresh()).levels[0]).toMatchObject({ completed: 5, ratio: 5 / 7 });
  });
  it("formula example: tuntas, tuntas, terlewat, tuntas is 3/7", () => {
    const o = outcomes(1, start, ["completed", "completed", "missed", "completed"]);
    expect(computeLevelProgress(o, fresh()).levels[0]).toMatchObject({ completed: 3, required: 7 });
  });
  it("LEVEL-03 the 7th completed session unlocks Level 2 from the next session", () => {
    const o = outcomes(1, start, Array(7).fill("completed")); // keys 11-01..11-07, 7th = 11-07
    const r = checkUnlock(fresh(), o, { now: wib("2026-11-07 22:00"), activeKey: "2026-11-08" });
    expect(r.newlyUnlocked).toBe(2);
    expect(r.state.effectiveFromSessionKey[2]).toBe("2026-11-09");
    expect(levelForSession(r.state, "2026-11-08")).toBe(1);
    expect(levelForSession(r.state, "2026-11-09")).toBe(2);
    expect(isUnlocked(r.state, 3)).toBe(false);
  });
  it("LEVEL-03 if the 7th completes in the running session, effect is the day after it", () => {
    const o = outcomes(1, start, Array(7).fill("completed"));
    const r = checkUnlock(fresh(), o, { now: wib("2026-11-07 05:00"), activeKey: "2026-11-07" });
    expect(r.state.effectiveFromSessionKey[2]).toBe("2026-11-08");
  });
  it("LEVEL-04 the running session keeps its level when unlock happens", () => {
    const o = outcomes(1, start, Array(7).fill("completed"));
    const r = checkUnlock(fresh(), o, { now: wib("2026-11-07 05:00"), activeKey: "2026-11-07" });
    expect(r.state.currentLevel).toBe(1);
    expect(levelForSession(r.state, "2026-11-07")).toBe(1);
  });
  it("does not unlock at 6 and is idempotent after unlock", () => {
    const six = outcomes(1, start, Array(6).fill("completed"));
    expect(
      checkUnlock(fresh(), six, { now: wib("2026-11-07 05:00"), activeKey: "2026-11-07" }).newlyUnlocked,
    ).toBeNull();
    const seven = outcomes(1, start, Array(7).fill("completed"));
    const first = checkUnlock(fresh(), seven, { now: wib("2026-11-07 22:00"), activeKey: "2026-11-08" });
    const again = checkUnlock(first.state, seven, { now: wib("2026-11-20 22:00"), activeKey: "2026-11-20" });
    expect(again.newlyUnlocked).toBeNull();
    expect(again.state.effectiveFromSessionKey[2]).toBe("2026-11-09");
    expect(again.state.currentLevel).toBe(2);
  });
  it("SESSION-05 a correction that lowers Level 1 completions keeps Level 2 unlocked", () => {
    const seven = outcomes(1, start, Array(7).fill("completed"));
    const unlocked = checkUnlock(fresh(), seven, { now: wib("2026-11-07 22:00"), activeKey: "2026-11-08" }).state;
    const corrected = seven.map((o, i) => (i === 6 ? { ...o, status: "partial" as const } : o));
    const r = checkUnlock(unlocked, corrected, { now: wib("2026-11-09 08:00"), activeKey: "2026-11-09" });
    expect(isUnlocked(r.state, 2)).toBe(true);
    expect(r.state.effectiveFromSessionKey[2]).toBe("2026-11-09");
    const p = computeLevelProgress(corrected, r.state);
    expect(p.levels[0]!.completed).toBe(6);
    expect(p.levels[1]!.unlocked).toBe(true);
  });
  it("counts progress per snapshot level and unlocks Level 3 after 12 at Level 2", () => {
    const l1 = outcomes(1, start, Array(7).fill("completed"));
    const l2 = outcomes(2, "2026-11-09", Array(12).fill("completed")); // 11-09..11-20
    const s1 = checkUnlock(fresh(), l1, { now: wib("2026-11-07 22:00"), activeKey: "2026-11-08" }).state;
    const r = checkUnlock(s1, [...l1, ...l2], { now: wib("2026-11-20 22:00"), activeKey: "2026-11-21" });
    expect(r.newlyUnlocked).toBe(3);
    expect(r.state.effectiveFromSessionKey[3]).toBe("2026-11-22");
    expect(completedAtLevel([...l1, ...l2], 2)).toHaveLength(12);
  });
  it("unlocks two levels at once for backfilled history", () => {
    const all = [
      ...outcomes(1, start, Array(7).fill("completed")),
      ...outcomes(2, "2026-11-08", Array(12).fill("completed")),
    ];
    const r = checkUnlock(fresh(), all, { now: wib("2026-11-30 10:00"), activeKey: "2026-11-30" });
    expect(isUnlocked(r.state, 3)).toBe(true);
    expect(r.state.currentLevel).toBe(1);
  });
  it("milestone: 20 sessions at Level 3 completes the journey and stays at Level 3", () => {
    const s = initialLevelState(start, wib("2026-10-31 20:00"));
    s.effectiveFromSessionKey = { 1: start, 2: "2026-11-09", 3: "2026-11-22" };
    s.currentLevel = 3;
    const o = outcomes(3, "2026-11-22", Array(20).fill("completed"));
    const p = computeLevelProgress(o, s);
    expect(p.journeyCompleted).toBe(true);
    expect(p.levels[2]).toMatchObject({ completed: 20, ratio: 1, isCurrent: true });
  });
});

describe("reporting", () => {
  it("REPORT-01 4 completed, 2 partial, 1 missed over 7 days is 57.14%", () => {
    const days = seq("2026-11-01", [
      "completed",
      "partial",
      "completed",
      "missed",
      "completed",
      "partial",
      "completed",
    ]);
    expect(completionRate(days)).toBe(57.14);
    expect(statusCounts(days)).toEqual({ completed: 4, partial: 2, missed: 1, excused: 0, upcoming: 0 });
  });
  it("REPORT-01 the 7 day filter picks the last 7 closed days", () => {
    const days = seq("2026-11-01", Array(10).fill("completed")).concat(day("2026-11-11", "upcoming"));
    const week = selectPeriod(days, 7, "2026-11-01", "2026-11-11");
    expect(week.map((d) => d.date)[0]).toBe("2026-11-04");
    expect(week).toHaveLength(7);
  });
  it("REPORT-02 a new user gets null, not 0%", () => {
    const days = buildCalendar({
      programStartDate: "2026-11-12",
      activeKey: "2026-11-12",
      records: [],
      excusedDates: [],
    });
    expect(completionRate(days)).toBeNull();
    expect(completionRate([])).toBeNull();
    expect(pickInsight({ days, activeKey: "2026-11-12", levels: [] })).toBeNull();
  });
  it("BUG-13 period starts at program_start_date, not before", () => {
    const days = seq("2026-11-08", ["missed", "completed", "completed", "completed", "upcoming"]);
    const p = selectPeriod(days, 30, "2026-11-08", "2026-11-12"); // closed days: 11-08..11-11
    expect(p).toHaveLength(4);
    expect(p[0]!.date).toBe("2026-11-08");
    expect(completionRate(p)).toBe(75);
  });
  it("excused and upcoming stay out of the denominator", () => {
    expect(completionRate(seq("2026-11-01", ["completed", "excused", "upcoming", "missed"]))).toBe(50);
    expect(completionRate(seq("2026-11-01", ["excused", "upcoming"]))).toBeNull();
  });
  it("LEVEL-05 per-activity stats use the targets frozen in each session", () => {
    const old = record("2026-11-01", 1, "all");
    old.activities = old.activities.map((a) => (a.id === "night:istighfar" ? { ...a, target: 50, count: 50 } : a));
    const now = record("2026-11-02", 1, "all");
    const s = activityStats([old, now]).find((x) => x.id === "night:istighfar")!;
    expect(s).toMatchObject({
      sessions: 2,
      withProgress: 2,
      timesCompleted: 2,
      totalCount: 150,
      phase: "night",
      key: "istighfar",
    });
  });
  it("counts a half-done counter as progress but not completed", () => {
    const r = record("2026-11-01", 1, "all");
    r.activities = r.activities.map((a) => (a.id === "night:shalawat" ? { ...a, count: 40 } : a));
    expect(activityStats([r]).find((x) => x.id === "night:shalawat")).toMatchObject({
      withProgress: 1,
      timesCompleted: 0,
    });
  });
});

describe("insight", () => {
  const lv = (completed: number, required = 7) => [
    { level: 1 as const, completed, required, ratio: completed / required, unlocked: true, isCurrent: true },
  ];
  it("first completed session", () => {
    const days = seq("2026-11-08", ["missed", "missed", "completed", "upcoming"]);
    expect(pickInsight({ days, activeKey: "2026-11-11", levels: lv(1) })?.type).toBe("first_completion");
  });
  it("return after 3 missed nights", () => {
    const days = seq("2026-11-01", ["completed", "completed", "missed", "missed", "missed", "partial", "upcoming"]);
    expect(pickInsight({ days, activeKey: "2026-11-07", levels: lv(2) })?.type).toBe("return_after_gap");
  });
  it("skips excused nights when measuring the gap, and ignores a short gap", () => {
    const short = seq("2026-11-01", ["completed", "completed", "missed", "missed", "completed", "upcoming"]);
    expect(pickInsight({ days: short, activeKey: "2026-11-06", levels: lv(2) })?.type).not.toBe("return_after_gap");
    const withExcuse = seq("2026-11-01", [
      "completed",
      "completed",
      "missed",
      "excused",
      "missed",
      "missed",
      "completed",
      "upcoming",
    ]);
    expect(pickInsight({ days: withExcuse, activeKey: "2026-11-08", levels: lv(3) })?.type).toBe("return_after_gap");
  });
  it("milestone at halfway and one session left", () => {
    const base = seq("2026-11-01", ["completed", "completed", "missed", "completed", "completed", "upcoming"]);
    const half = pickInsight({ days: base, activeKey: "2026-11-06", levels: lv(4) });
    expect(half).toMatchObject({ type: "milestone_progress" });
    expect(half?.message).toBe("4 dari 7 sesi tuntas di Level 1.");
    expect(pickInsight({ days: base, activeKey: "2026-11-06", levels: lv(6) })?.type).toBe("milestone_progress");
  });
  it("improvement when the last 7 beat the 7 before by 15 points", () => {
    const days = seq("2026-11-01", [
      ...Array(7).fill("missed"),
      "completed",
      "completed",
      "completed",
      "missed",
      "completed",
      "completed",
      "missed",
      "upcoming",
    ]);
    expect(pickInsight({ days, activeKey: "2026-11-15", levels: lv(5) })?.type).toBe("improvement");
  });
  it("stable consistency when 5 or more of the last 7 are completed", () => {
    const days = seq("2026-11-01", [
      ...Array(7).fill("completed"),
      "completed",
      "missed",
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
      "upcoming",
    ]);
    const i = pickInsight({ days, activeKey: "2026-11-15", levels: lv(1) });
    expect(i?.type).toBe("stable_consistency");
    expect(i?.message).toBe("6 dari 7 sesi terakhir tuntas. Ritmemu stabil.");
  });
  it("returns null when nothing honest applies and never uses scores or rankings", () => {
    const days = seq("2026-11-01", ["partial", "missed", "partial", "missed", "partial", "upcoming"]);
    expect(pickInsight({ days, activeKey: "2026-11-06", levels: lv(0) })).toBeNull();
  });
});
