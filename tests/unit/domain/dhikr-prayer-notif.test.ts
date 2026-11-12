import { describe, expect, it } from "vitest";
import {
  FLUSH_INTERVAL_MS,
  applyAcks,
  displayCount,
  extraCount,
  flush,
  initCounter,
  isTargetReached,
  receiveServerCount,
  reset,
  shouldFlush,
  tap,
  type CounterOperation,
  type CounterState,
} from "@/domain/dhikr/counter";
import {
  MAX_BATCH,
  applyBatch,
  applyOperation,
  clampRecordedAt,
  emptyCounterStore,
  type CounterStore,
  type ServerContext,
} from "@/domain/dhikr/server";
import { alKahfiWindow, isInAlKahfiWindow } from "@/domain/prayer/al-kahfi";
import {
  chooseSchedule,
  isCacheUsable,
  manualSchedule,
  scheduleFajrDate,
  type PrayerSchedule,
} from "@/domain/prayer/schedule";
import { planWake } from "@/domain/prayer/wake-plan";
import { selectBedtimeMessage, renderTemplate } from "@/domain/notifications/bedtime";
import { dedupeKey, decideSend, isExpired, isInQuietHours, type QuietHours } from "@/domain/notifications/delivery";
import { addDays, zonedInstant } from "@/domain/time/tz";
import { wib } from "./helpers";

const NOW = wib("2026-11-13 02:00");
const ctx = (over: Partial<ServerContext> = {}): ServerContext => ({
  userId: "u1",
  now: NOW,
  activity: () => ({ target: 100, windowOpen: true }),
  ...over,
});
let uid = 0;
const id = () => `op-${++uid}`;

/** Drives the client reducer + server like a real device would, with a fake clock. */
function device(activityId: string, serverCount = 0) {
  let s: CounterState = initCounter(activityId, 100, serverCount);
  const sent: CounterOperation[] = [];
  return {
    get state() {
      return s;
    },
    sent,
    tap(now: number) {
      s = tap(s, now);
      if (shouldFlush(s, { now })) this.flush(now);
    },
    tick(now: number) {
      if (shouldFlush(s, { now })) this.flush(now);
    },
    flush(now: number) {
      const r = flush(s, id(), now);
      s = r.state;
      if (r.operation) sent.push(r.operation);
      return r.operation;
    },
    ack(results: Parameters<typeof applyAcks>[1]) {
      s = applyAcks(s, results);
    },
    refresh(count: number) {
      s = receiveServerCount(s, count);
    },
    set(next: CounterState) {
      s = next;
    },
  };
}

describe("dhikr client reducer", () => {
  it("DZIKIR-01 20/100 plus one tap shows 21/100 immediately", () => {
    const d = device("a", 20);
    d.tap(0);
    expect(displayCount(d.state)).toBe(21);
    expect(d.state.target).toBe(100);
  });
  it("never goes negative, minus at zero is a no-op", () => {
    const s = initCounter("a", 10);
    expect(tap(s, 0, -1)).toBe(s);
    const one = tap(tap(s, 0), 1, -1);
    expect(displayCount(one)).toBe(0);
  });
  it("DZIKIR-04 100 taps in 20 seconds make at most 15 requests and reach 100 on the server", () => {
    const d = device("a");
    let store: CounterStore = emptyCounterStore();
    const c = ctx({ activity: () => ({ target: 100, windowOpen: true }) });
    for (let i = 0; i < 100; i++) {
      d.tap(i * 200); // one tap every 200 ms = 20 s
    }
    d.tick(20_000 + FLUSH_INTERVAL_MS);
    expect(d.sent.length).toBeLessThanOrEqual(15);
    const r = applyBatch(store, d.sent, c);
    store = r.store;
    d.ack(r.results);
    expect(store.counts["u1:a"]).toBe(100);
    expect(displayCount(d.state)).toBe(100);
    expect(d.state.inflight).toHaveLength(0);
  });
  it("flushes at 2 s, at target, when leaving, and not when idle", () => {
    const d = device("a");
    expect(shouldFlush(d.state, { now: 5_000 })).toBe(false);
    d.set(tap(d.state, 1_000));
    expect(shouldFlush(d.state, { now: 2_999 })).toBe(false);
    expect(shouldFlush(d.state, { now: 3_000 })).toBe(true);
    expect(shouldFlush(d.state, { now: 1_100, leaving: true })).toBe(true);
    const near = tap(initCounter("a", 100, 99), 0);
    expect(shouldFlush(near, { now: 1 })).toBe(true);
    // already past target: no extra flush per tap
    const over = tap(initCounter("a", 100, 100), 0);
    expect(shouldFlush(over, { now: 1 })).toBe(false);
  });
  it("splits an oversized buffer into operations of at most 1000", () => {
    let s = initCounter("a", 5000);
    s = { ...s, pendingDelta: 2500, bufferedSince: 0 };
    expect(shouldFlush(s, { now: 1 })).toBe(true);
    const r1 = flush(s, "x1", 5);
    expect(r1.operation).toMatchObject({ kind: "delta", delta: 1000 });
    expect(r1.state.pendingDelta).toBe(1500);
    expect(r1.state.bufferedSince).toBe(5);
    expect(flush(initCounter("a", 5), "x", 0).operation).toBeNull();
  });
  it("shows server count + in-flight + buffered, and +N lebih after target", () => {
    let s = initCounter("a", 10, 8);
    s = flush(tap(tap(tap(s, 0), 0), 0), "o1", 1).state; // 3 in flight
    s = tap(s, 2); // 1 buffered
    expect(displayCount(s)).toBe(12);
    expect(isTargetReached(s)).toBe(true);
    expect(extraCount(s)).toBe(2);
    expect(extraCount(initCounter("a", 10, 3))).toBe(0);
  });
  it("BUG-10 reset sends set_zero, drops unsent taps and later deltas still apply", () => {
    const d = device("a", 50);
    d.set(tap(d.state, 0));
    d.set(reset(d.state, "z1", 10).state);
    expect(displayCount(d.state)).toBe(0);
    expect(d.state.inflight.map((o) => o.kind)).toEqual(["set_zero"]);
    d.set(tap(d.state, 20));
    expect(displayCount(d.state)).toBe(1);
    const op = reset(initCounter("a", 5, 3), "z2", 0).operation;
    expect(op).toMatchObject({ kind: "set_zero", operationId: "z2" });
  });
  it("keeps rejected operations visible to the UI instead of dropping them", () => {
    let s = initCounter("a", 10);
    s = flush(tap(s, 0), "r1", 1).state;
    s = applyAcks(s, [{ operationId: "r1", status: "rejected", authoritativeCount: 0 }]);
    expect(s.rejected).toEqual(["r1"]);
    expect(s.inflight).toHaveLength(0);
    expect(applyAcks(s, [{ operationId: "unknown", status: "accepted", authoritativeCount: 9 }])).toBe(s);
  });
});

describe("dhikr server", () => {
  const delta = (operationId: string, n: number, activityId = "a"): CounterOperation => ({
    kind: "delta",
    operationId,
    activityId,
    delta: n,
    clientRecordedAt: NOW.toISOString(),
  });
  it("DZIKIR-03 an operation id already processed is not applied twice", () => {
    const first = applyOperation(emptyCounterStore(), delta("same", 5), ctx());
    const dup = applyOperation(first.store, delta("same", 5), ctx());
    expect(first.result).toMatchObject({ status: "accepted", authoritativeCount: 5 });
    expect(dup.result).toMatchObject({ status: "duplicate", authoritativeCount: 5 });
    expect(dup.store.counts["u1:a"]).toBe(5);
  });
  it("DZIKIR-02 offline taps sent later apply once, even if the request is retried", () => {
    const d = device("a");
    for (let i = 0; i < 7; i++) d.tap(i * 100);
    d.flush(5_000);
    let store = emptyCounterStore();
    store = applyBatch(store, d.sent, ctx()).store;
    const retry = applyBatch(store, d.sent, ctx()); // lost response, client resends
    expect(retry.results.every((r) => r.status === "duplicate")).toBe(true);
    expect(retry.store.counts["u1:a"]).toBe(7);
  });
  it("DZIKIR-05 two devices tapping 30 each both end at 60 after sync", () => {
    const a = device("act");
    const b = device("act");
    for (let i = 0; i < 30; i++) {
      a.tap(i * 100);
      b.tap(i * 100 + 50);
    }
    a.flush(10_000);
    b.flush(10_000);
    let store = emptyCounterStore();
    const ra = applyBatch(store, a.sent, ctx());
    store = ra.store;
    const rb = applyBatch(store, b.sent, ctx());
    store = rb.store;
    a.ack(ra.results);
    b.ack(rb.results);
    expect(store.counts["u1:act"]).toBe(60);
    a.refresh(store.counts["u1:act"]!);
    expect(displayCount(a.state)).toBe(60);
    expect(displayCount(b.state)).toBe(60);
  });
  it("never lets the server count go below zero", () => {
    const r = applyOperation(emptyCounterStore(), delta("neg", -5), ctx());
    expect(r.result.authoritativeCount).toBe(0);
  });
  it("set_zero resets, keeps history, and later deltas apply", () => {
    let s = applyOperation(emptyCounterStore(), delta("o1", 10), ctx()).store;
    const z: CounterOperation = {
      kind: "set_zero",
      operationId: "z",
      activityId: "a",
      clientRecordedAt: NOW.toISOString(),
    };
    s = applyOperation(s, z, ctx()).store;
    expect(s.counts["u1:a"]).toBe(0);
    s = applyOperation(s, delta("o2", 3), ctx()).store;
    expect(s.counts["u1:a"]).toBe(3);
    expect(Object.keys(s.applied)).toHaveLength(3);
  });
  it("rejects invalid deltas, unknown activities and locked sessions", () => {
    expect(applyOperation(emptyCounterStore(), delta("i1", 1001), ctx()).result.errorCode).toBe("INVALID_DELTA");
    expect(applyOperation(emptyCounterStore(), delta("i2", 0), ctx()).result.errorCode).toBe("INVALID_DELTA");
    expect(applyOperation(emptyCounterStore(), delta("i3", 1.5), ctx()).result.errorCode).toBe("INVALID_DELTA");
    expect(applyOperation(emptyCounterStore(), delta("u1", 1), ctx({ activity: () => null })).result.errorCode).toBe(
      "ACTIVITY_NOT_FOUND",
    );
    const locked = applyOperation(
      emptyCounterStore(),
      delta("l1", 1),
      ctx({ activity: () => ({ target: 10, windowOpen: false }) }),
    );
    expect(locked.result).toMatchObject({ status: "rejected", errorCode: "SESSION_LOCKED" });
    expect(locked.store.counts["u1:a"]).toBeUndefined();
  });
  it("keeps users separate even with the same operation id", () => {
    const s1 = applyOperation(emptyCounterStore(), delta("shared", 4), ctx({ userId: "u1" })).store;
    const s2 = applyOperation(s1, delta("shared", 4), ctx({ userId: "u2" }));
    expect(s2.result.status).toBe("accepted");
    expect(s2.store.counts).toEqual({ "u1:a": 4, "u2:a": 4 });
  });
  it("BUG-09 clamps client time more than 5 minutes in the future", () => {
    expect(clampRecordedAt("2026-11-13T02:04:00+07:00", NOW)).toBe("2026-11-12T19:04:00.000Z");
    expect(clampRecordedAt("2026-11-13T02:06:00+07:00", NOW)).toBe(NOW.toISOString());
    expect(clampRecordedAt("garbage", NOW)).toBe(NOW.toISOString());
    const far: CounterOperation = { ...delta("f", 1), clientRecordedAt: "2030-01-01T00:00:00Z" };
    const s = applyOperation(emptyCounterStore(), far, ctx()).store;
    expect(s.applied["u1:f"]!.recordedAt).toBe(NOW.toISOString());
  });
  it("accepts at most 50 operations per batch", () => {
    const ops = Array.from({ length: MAX_BATCH + 1 }, (_, i) => delta(`b${i}`, 1));
    expect(() => applyBatch(emptyCounterStore(), ops, ctx())).toThrow(RangeError);
    const ok = applyBatch(emptyCounterStore(), ops.slice(0, MAX_BATCH), ctx());
    expect(ok.store.counts["u1:a"]).toBe(50);
    expect(ok.results.at(-1)?.completed).toBe(false);
  });
  it("marks completed when the authoritative count reaches the target", () => {
    const r = applyOperation(emptyCounterStore(), delta("c", 100), ctx());
    expect(r.result.completed).toBe(true);
  });
});

describe("prayer", () => {
  const fajr = wib("2026-11-13 04:30");
  it("wake = fajr - duration - buffer for each level (60/120/150 + 10)", () => {
    expect(planWake({ fajrAt: fajr, level: 1 }).wakeAt.toISOString()).toBe(wib("2026-11-13 03:20").toISOString());
    expect(planWake({ fajrAt: fajr, level: 2 }).wakeAt.toISOString()).toBe(wib("2026-11-13 02:20").toISOString());
    expect(planWake({ fajrAt: fajr, level: 3 }).wakeAt.toISOString()).toBe(wib("2026-11-13 01:50").toISOString());
    expect(planWake({ fajrAt: fajr, level: 1, durationMinutes: 30, bufferMinutes: 0 }).wakeAt.toISOString()).toBe(
      wib("2026-11-13 04:00").toISOString(),
    );
  });
  it("warns neutrally when sleep is under 5 hours, and only then", () => {
    const short = planWake({ fajrAt: fajr, level: 2, sleepAt: wib("2026-11-12 22:30") }); // wake 02:20 -> 3h50
    expect(short.sleepWarning).toBe(
      "Jadwalmu menyisakan sekitar 4 jam tidur. Mau coba tidur lebih awal atau memakai durasi ibadah yang lebih singkat?",
    );
    expect(short.sleepHours).toBeCloseTo(3.833, 2);
    expect(planWake({ fajrAt: fajr, level: 1, sleepAt: wib("2026-11-12 21:00") }).sleepWarning).toBeNull(); // 6h20
    expect(planWake({ fajrAt: fajr, level: 1 }).sleepWarning).toBeNull();
  });
  it("exactly 5 hours of sleep is enough", () => {
    expect(planWake({ fajrAt: fajr, level: 1, sleepAt: wib("2026-11-12 22:20") }).sleepWarning).toBeNull();
  });
  it("PRAYER-03 manual schedule is labelled 'Diatur manual' and drives the planner", () => {
    const manual = manualSchedule({
      date: "2026-11-13",
      timezone: "Asia/Riyadh",
      fajrAt: new Date("2026-11-13T02:10:00Z"),
      now: NOW,
    });
    const choice = chooseSchedule({ mode: "manual", manual, date: "2026-11-13", now: NOW });
    expect(choice).toMatchObject({
      ok: true,
      label: "Diatur manual",
      schedule: { source: "manual", regionId: null, maghribAt: null },
    });
    if (!choice.ok) throw new Error();
    expect(planWake({ fajrAt: new Date(choice.schedule.fajrAt), level: 1 }).wakeAt.toISOString()).toBe(
      "2026-11-13T01:00:00.000Z",
    );
    expect(scheduleFajrDate(choice.schedule)).toBe("2026-11-13");
    expect(chooseSchedule({ mode: "manual", manual, date: "2026-11-14", now: NOW })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(chooseSchedule({ mode: "manual", date: "2026-11-13", now: NOW })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
  it("PRAYER-02 provider down: valid cache is labelled 'Jadwal tersimpan', stale cache is not shown", () => {
    const cached: PrayerSchedule = {
      regionId: "jkt",
      localDate: "2026-11-13",
      timezone: "Asia/Jakarta",
      fajrAt: "2026-11-12T21:40:00Z",
      maghribAt: null,
      source: "provider",
      fetchedAt: "2026-11-01T00:00:00Z",
      validUntil: "2026-11-30T00:00:00Z",
    };
    expect(chooseSchedule({ mode: "region", provider: null, cached, date: "2026-11-13", now: NOW })).toMatchObject({
      ok: true,
      label: "Jadwal tersimpan",
      schedule: { source: "cached" },
    });
    expect(chooseSchedule({ mode: "region", cached, date: "2026-11-14", now: NOW })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(
      chooseSchedule({ mode: "region", cached, date: "2026-11-13", now: new Date("2026-12-02T00:00:00Z") }),
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(isCacheUsable({ ...cached, validUntil: null }, "2026-11-13", NOW)).toBe(true);
    expect(isCacheUsable(null, "2026-11-13", NOW)).toBe(false);
  });
  it("prefers fresh provider data and labels it as such", () => {
    const provider: PrayerSchedule = {
      regionId: "jkt",
      localDate: "2026-11-13",
      timezone: "Asia/Jakarta",
      fajrAt: "2026-11-12T21:40:00Z",
      maghribAt: null,
      source: "cached",
      fetchedAt: NOW.toISOString(),
      validUntil: null,
    };
    expect(chooseSchedule({ mode: "region", provider, date: "2026-11-13", now: NOW })).toMatchObject({
      label: "Jadwal terkini",
      schedule: { source: "provider" },
    });
  });
  describe("Al-Kahfi window", () => {
    const tz = "Asia/Jakarta";
    const maghrib = (d: string) => zonedInstant(d, 17, 50, tz);
    it("runs from Thursday Maghrib to Friday Maghrib", () => {
      const w = alKahfiWindow({ now: wib("2026-11-12 10:00"), tz, maghribFor: maghrib })!; // Thursday
      expect(w.fridayDate).toBe("2026-11-13");
      expect(w.usedFallback).toBe(false);
      expect(isInAlKahfiWindow(w, wib("2026-11-12 17:49"))).toBe(false);
      expect(isInAlKahfiWindow(w, wib("2026-11-12 17:50"))).toBe(true);
      expect(isInAlKahfiWindow(w, wib("2026-11-13 17:49"))).toBe(true);
      expect(isInAlKahfiWindow(w, wib("2026-11-13 17:50"))).toBe(false);
      expect(alKahfiWindow({ now: wib("2026-11-13 08:00"), tz, maghribFor: maghrib })?.fridayDate).toBe("2026-11-13");
    });
    it("returns null on other weekdays", () => {
      expect(alKahfiWindow({ now: wib("2026-11-14 08:00"), tz, maghribFor: maghrib })).toBeNull();
      expect(isInAlKahfiWindow(null, NOW)).toBe(false);
    });
    it("falls back to 18.00 for manual schedules without Maghrib", () => {
      const w = alKahfiWindow({ now: wib("2026-11-12 10:00"), tz, maghribFor: () => null })!;
      expect(w.usedFallback).toBe(true);
      expect(w.start.toISOString()).toBe(wib("2026-11-12 18:00").toISOString());
      expect(w.end.toISOString()).toBe(wib("2026-11-13 18:00").toISOString());
    });
  });
});

describe("notifications", () => {
  const bank = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, template: `Pesan ${i}` }));
  it("NOTIF-01 two nights in a row never repeat the message", () => {
    const n1 = selectBedtimeMessage(bank, [])!;
    const n2 = selectBedtimeMessage(bank, [{ messageId: n1.id, sentOn: "2026-11-12" }])!;
    expect(n2.id).not.toBe(n1.id);
  });
  it("avoids the last 14, then falls back to the one unsent the longest", () => {
    const big = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, template: "x" }));
    const hist = Array.from({ length: 14 }, (_, i) => ({ messageId: `m${i}`, sentOn: addDays("2026-10-30", i) }));
    expect(selectBedtimeMessage(big, hist)!.id).toBe("m14");
    const small = Array.from({ length: 3 }, (_, i) => ({ id: `m${i}`, template: "x" }));
    const used = [
      { messageId: "m1", sentOn: "2026-11-10" },
      { messageId: "m2", sentOn: "2026-11-11" },
      { messageId: "m0", sentOn: "2026-11-12" },
    ];
    expect(selectBedtimeMessage(small, used)!.id).toBe("m1");
    expect(selectBedtimeMessage([], [])).toBeNull();
  });
  it("renders only whitelisted variables", () => {
    expect(renderTemplate("Halo {nama}, Level {level}", { nama: "Pengguna Demo", level: 2 })).toBe(
      "Halo Pengguna Demo, Level 2",
    );
    expect(() => renderTemplate("Halo {email}", { nama: "x", level: 1 })).toThrow(/not allowed/);
  });
  it("builds a unique dedupe key per user, type and local date", () => {
    expect(dedupeKey("u1", "bedtime", "2026-11-12")).toBe("u1:bedtime:2026-11-12");
  });
  it("NOTIF-04 a tahajud job for 03.00 is expired when the worker runs at 03.20", () => {
    const at = wib("2026-11-13 03:00");
    expect(isExpired("tahajud", at, wib("2026-11-13 03:14"))).toBe(false);
    expect(isExpired("tahajud", at, wib("2026-11-13 03:20"))).toBe(true);
    expect(isExpired("bedtime", at, wib("2026-11-13 03:31"))).toBe(true);
    expect(isExpired("fajr", at, wib("2026-11-13 03:19"))).toBe(false);
    expect(isExpired("alkahfi", at, wib("2026-11-13 08:59"))).toBe(false);
    expect(isExpired("achievement", at, wib("2026-11-14 03:01"))).toBe(true);
    expect(
      decideSend({
        type: "tahajud",
        scheduledAt: at,
        now: wib("2026-11-13 03:20"),
        tz: "Asia/Jakarta",
        typeEnabled: true,
        quiet: off,
      }),
    ).toEqual({ send: false, reason: "expired" });
  });
  const off: QuietHours = { enabled: false, start: "22:00", end: "04:00", allowWorship: false };
  const quiet: QuietHours = { enabled: true, start: "22:00", end: "04:00", allowWorship: false };
  it("NOTIF-05 quiet hours 22.00-04.00 block a 22.30 bedtime", () => {
    const at = wib("2026-11-12 22:30");
    expect(isInQuietHours(at, "Asia/Jakarta", quiet)).toBe(true);
    expect(
      decideSend({ type: "bedtime", scheduledAt: at, now: at, tz: "Asia/Jakarta", typeEnabled: true, quiet }),
    ).toEqual({ send: false, reason: "quiet_hours" });
  });
  it("lets tahajud and fajr through quiet hours only when the user allows worship", () => {
    const at = wib("2026-11-13 03:00");
    const base = { scheduledAt: at, now: at, tz: "Asia/Jakarta", typeEnabled: true } as const;
    expect(decideSend({ ...base, type: "tahajud", quiet })).toEqual({ send: false, reason: "quiet_hours" });
    expect(decideSend({ ...base, type: "tahajud", quiet: { ...quiet, allowWorship: true } })).toEqual({ send: true });
    expect(decideSend({ ...base, type: "alkahfi", quiet: { ...quiet, allowWorship: true } })).toEqual({
      send: false,
      reason: "quiet_hours",
    });
  });
  it("NOTIF-02 disabled types are never sent; quiet hours handle plain ranges and off", () => {
    const at = wib("2026-11-12 21:00");
    expect(
      decideSend({ type: "bedtime", scheduledAt: at, now: at, tz: "Asia/Jakarta", typeEnabled: false, quiet: off }),
    ).toEqual({ send: false, reason: "disabled" });
    expect(isInQuietHours(at, "Asia/Jakarta", off)).toBe(false);
    expect(
      isInQuietHours(wib("2026-11-12 13:00"), "Asia/Jakarta", {
        enabled: true,
        start: "12:00",
        end: "14:00",
        allowWorship: false,
      }),
    ).toBe(true);
    expect(
      isInQuietHours(wib("2026-11-12 15:00"), "Asia/Jakarta", {
        enabled: true,
        start: "12:00",
        end: "14:00",
        allowWorship: false,
      }),
    ).toBe(false);
    expect(
      isInQuietHours(at, "Asia/Jakarta", { enabled: true, start: "10:00", end: "10:00", allowWorship: false }),
    ).toBe(false);
  });
});
