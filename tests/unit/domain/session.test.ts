import { describe, expect, it } from "vitest";
import {
  activeSessionKey,
  correctionDeadline,
  cutoffInstant,
  isSessionClosed,
  isWithinCorrectionWindow,
} from "@/domain/session/keys";
import { SESSION_STATES, isFinalState, toDisplayStatus, transition } from "@/domain/session/state-machine";
import { computeSessionStatus, isActivityDone, hasProgress, type ActivityProgress } from "@/domain/session/status";
import { createSessionSnapshot } from "@/domain/content/snapshot";
import {
  addDays,
  dateRange,
  diffDays,
  isLocalDate,
  isValidTimeZone,
  localDate,
  parseClock,
  weekdayOf,
  zonedInstant,
} from "@/domain/time/tz";
import { progressFor, wib } from "./helpers";

const JKT = "Asia/Jakarta";

describe("time helpers", () => {
  it("computes local dates by zone, not by server zone", () => {
    const i = new Date("2026-11-12T17:30:00Z"); // 00:30 WIB, 01:30 WITA, 02:30 WIT, still 12 Nov in UTC
    expect(localDate(i, "UTC")).toBe("2026-11-12");
    expect(localDate(i, "Asia/Jakarta")).toBe("2026-11-13");
    expect(localDate(i, "Asia/Makassar")).toBe("2026-11-13");
    expect(localDate(i, "Asia/Jayapura")).toBe("2026-11-13");
  });
  it("builds instants from wall clock in each Indonesian zone and in a DST zone", () => {
    expect(zonedInstant("2026-11-13", 12, 0, "Asia/Jakarta").toISOString()).toBe("2026-11-13T05:00:00.000Z");
    expect(zonedInstant("2026-11-13", 12, 0, "Asia/Makassar").toISOString()).toBe("2026-11-13T04:00:00.000Z");
    expect(zonedInstant("2026-11-13", 12, 0, "Asia/Jayapura").toISOString()).toBe("2026-11-13T03:00:00.000Z");
    expect(zonedInstant("2026-07-01", 12, 0, "Europe/London").toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(zonedInstant("2026-01-01", 12, 0, "Europe/London").toISOString()).toBe("2026-01-01T12:00:00.000Z");
  });
  it("does date arithmetic across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(diffDays("2026-11-01", "2026-11-13")).toBe(12);
    expect(dateRange("2026-11-12", "2026-11-14")).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
    expect(dateRange("2026-11-14", "2026-11-12")).toEqual([]);
    expect(weekdayOf("2026-11-12")).toBe(4); // Thursday
  });
  it("validates inputs", () => {
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("2026-11-13")).toBe(true);
    expect(() => addDays("13-11-2026", 1)).toThrow(RangeError);
    expect(parseClock("04:30")).toEqual({ hour: 4, minute: 30 });
    expect(() => parseClock("25:00")).toThrow(RangeError);
    expect(isValidTimeZone("Asia/Jakarta")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });
});

describe("session key", () => {
  it("SESSION-03 flips from D to D+1 at 12.00 WIB", () => {
    expect(activeSessionKey(wib("2026-11-13 11:59"), JKT)).toBe("2026-11-13");
    expect(activeSessionKey(wib("2026-11-13 12:00"), JKT)).toBe("2026-11-14");
    expect(activeSessionKey(wib("2026-11-13 12:01"), JKT)).toBe("2026-11-14");
  });
  it("SESSION-01 keeps 23.50 and 00.20 in the same session key", () => {
    const start = activeSessionKey(wib("2026-11-12 23:50"), JKT);
    const end = activeSessionKey(wib("2026-11-13 00:20"), JKT);
    expect(start).toBe("2026-11-13");
    expect(end).toBe(start);
  });
  it("SESSION-01 holds across zones: WITA and WIT flip at their own noon", () => {
    const at = new Date("2026-11-13T04:30:00Z"); // 11:30 WIB, 12:30 WITA, 13:30 WIT
    expect(activeSessionKey(at, "Asia/Jakarta")).toBe("2026-11-13");
    expect(activeSessionKey(at, "Asia/Makassar")).toBe("2026-11-14");
    expect(activeSessionKey(at, "Asia/Jayapura")).toBe("2026-11-14");
  });
  it("handles month end", () => {
    expect(activeSessionKey(wib("2026-11-30 13:00"), JKT)).toBe("2026-12-01");
  });
  it("computes cutoff and correction window (48 h after cutoff)", () => {
    expect(cutoffInstant("2026-11-13", JKT).toISOString()).toBe("2026-11-13T05:00:00.000Z");
    expect(correctionDeadline("2026-11-13", JKT).toISOString()).toBe("2026-11-15T05:00:00.000Z");
    expect(isWithinCorrectionWindow("2026-11-13", wib("2026-11-15 11:59"), JKT)).toBe(true);
    expect(isWithinCorrectionWindow("2026-11-13", wib("2026-11-15 12:01"), JKT)).toBe(false);
    expect(isSessionClosed("2026-11-13", wib("2026-11-13 11:59"), JKT)).toBe(false);
    expect(isSessionClosed("2026-11-13", wib("2026-11-13 12:00"), JKT)).toBe(true);
  });
  it("SESSION-04 freezes timezone in the snapshot when the user changes region mid-session", () => {
    const snap = createSessionSnapshot({
      sessionKey: "2026-11-13",
      level: 1,
      timezone: "Asia/Jakarta",
      regionId: "jakarta",
      now: wib("2026-11-12 23:00"),
    });
    // user moves to WITA at 02:00; the session keeps using its own snapshot zone
    const now = wib("2026-11-13 02:00");
    expect(activeSessionKey(now, snap.timezone)).toBe(snap.sessionKey);
    expect(cutoffInstant(snap.sessionKey, snap.timezone).toISOString()).toBe("2026-11-13T05:00:00.000Z");
    // the next session is created with WITA and has its own cutoff
    const next = createSessionSnapshot({
      sessionKey: "2026-11-14",
      level: 1,
      timezone: "Asia/Makassar",
      regionId: "makassar",
      now,
    });
    expect(next.timezone).toBe("Asia/Makassar");
    expect(cutoffInstant(next.sessionKey, next.timezone).toISOString()).toBe("2026-11-14T04:00:00.000Z");
    expect(snap.timezone).toBe("Asia/Jakarta");
  });
});

describe("session state machine", () => {
  const open = { inCorrectionWindow: true };
  const shut = { inCorrectionWindow: false };
  it("allows the PRD §11.3 transitions", () => {
    expect(transition("scheduled", "in_progress", shut)).toEqual({ ok: true, to: "in_progress" });
    expect(transition("in_progress", "completed", shut).ok).toBe(true);
    expect(transition("in_progress", "partial", shut).ok).toBe(true);
    expect(transition("scheduled", "missed", shut).ok).toBe(true);
    expect(transition("scheduled", "excused", shut).ok).toBe(true);
    expect(transition("in_progress", "excused", shut).ok).toBe(true);
  });
  it("rejects shortcuts and no-op changes", () => {
    expect(transition("scheduled", "partial", shut)).toEqual({ ok: false, reason: "illegal" });
    expect(transition("in_progress", "missed", shut)).toEqual({ ok: false, reason: "illegal" });
    expect(transition("in_progress", "in_progress", shut)).toEqual({ ok: false, reason: "illegal" });
  });
  it("lets a correction change a final state only inside the window", () => {
    expect(transition("partial", "completed", open)).toEqual({ ok: true, to: "completed" });
    expect(transition("excused", "scheduled", open).ok).toBe(true);
    expect(transition("completed", "partial", shut)).toEqual({ ok: false, reason: "window_closed" });
  });
  it("maps states to display statuses and flags final states", () => {
    expect(toDisplayStatus("scheduled")).toBe("upcoming");
    expect(toDisplayStatus("in_progress")).toBe("upcoming");
    expect(toDisplayStatus("partial")).toBe("partial");
    expect(SESSION_STATES.filter(isFinalState)).toEqual(["completed", "partial", "missed", "excused"]);
  });
});

describe("computeSessionStatus", () => {
  const a = (over: Partial<ActivityProgress>): ActivityProgress => ({
    id: "x",
    kind: "counter",
    required: true,
    target: 10,
    count: 0,
    checked: false,
    ...over,
  });

  it("LEVEL-04 style: completed only when every required activity is done", () => {
    expect(computeSessionStatus({ activities: progressFor(1, "all"), excused: false, closed: false })).toBe(
      "completed",
    );
    const missingOne = progressFor(1, "all").map((p, i) => (i === 0 ? { ...p, checked: false } : p));
    expect(computeSessionStatus({ activities: missingOne, excused: false, closed: true })).toBe("partial");
  });
  it("ignores optional activities for completion", () => {
    const acts = progressFor(1, "all").map((p) => (!p.required ? { ...p, count: 0, checked: false } : p));
    expect(computeSessionStatus({ activities: acts, excused: false, closed: false })).toBe("completed");
  });
  it("BUG-07 no progress after cutoff is missed, any progress is partial", () => {
    expect(computeSessionStatus({ activities: progressFor(1, "none"), excused: false, closed: true })).toBe("missed");
    expect(computeSessionStatus({ activities: progressFor(1, "some"), excused: false, closed: true })).toBe("partial");
  });
  it("before cutoff reads scheduled or in_progress", () => {
    expect(computeSessionStatus({ activities: progressFor(1, "none"), excused: false, closed: false })).toBe(
      "scheduled",
    );
    expect(computeSessionStatus({ activities: progressFor(1, "some"), excused: false, closed: false })).toBe(
      "in_progress",
    );
  });
  it("BUG-06 counter must reach target, not just start", () => {
    expect(isActivityDone(a({ count: 9 }))).toBe(false);
    expect(isActivityDone(a({ count: 10 }))).toBe(true);
    expect(isActivityDone(a({ count: 12 }))).toBe(true);
    expect(isActivityDone(a({ target: null, count: 1 }))).toBe(true);
    expect(isActivityDone(a({ kind: "checklist", checked: true }))).toBe(true);
    expect(hasProgress(a({ count: 1 }))).toBe(true);
    expect(hasProgress(a({ kind: "checklist", checked: false }))).toBe(false);
  });
  it("excused wins over progress and keeps recording", () => {
    expect(computeSessionStatus({ activities: progressFor(1, "all"), excused: true, closed: true })).toBe("excused");
  });
  it("a session with no required activity is never auto-completed", () => {
    expect(computeSessionStatus({ activities: [a({ required: false })], excused: false, closed: true })).toBe("missed");
  });
});

describe("shared contract: session-status (used by StatusChip)", () => {
  it("keeps the exports Agent A depends on, with supportive labels", async () => {
    const m = await import("@/domain/content/session-status");
    expect(m.SESSION_STATUSES).toEqual(["completed", "partial", "missed", "excused", "upcoming"]);
    expect(m.SESSION_STATUS_LABEL).toEqual({
      completed: "Tuntas",
      partial: "Sebagian",
      missed: "Terlewat",
      excused: "Berhalangan",
      upcoming: "Akan datang",
    });
  });
});
