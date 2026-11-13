import { describe, expect, it } from "vitest";
import type { NotificationPreferences } from "@/data/contracts";
import { planNotifications, type PlannedDay } from "@/server/notifications/planner";

const TZ = "Asia/Jakarta";
const prefs = (over: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  bedtime: { enabled: true, target_sleep_time: "22:00", offset_minutes: 30 },
  tahajud: { enabled: true },
  fajr: { enabled: true },
  alkahfi: { enabled: true },
  achievement: { enabled: true },
  quiet_hours: { enabled: false, start: "22:00", end: "04:00", allow_worship: true },
  ...over,
});
/** Fajr 04:06 WIB, Maghrib 17:51 WIB. */
const day = (date: string): PlannedDay => ({
  fajrAt: new Date(`${date}T04:06:00+07:00`),
  maghribAt: new Date(`${date}T17:51:00+07:00`),
});
const days = (...dates: string[]) => new Map(dates.map((d) => [d, day(d)] as const));
const iso = (d: Date) => d.toISOString();
const U = "00000000-0000-4000-8000-000000000001";

// Thursday 12 Nov 2026, 10:00 WIB.
const NOW = new Date("2026-11-12T10:00:00+07:00");

describe("planNotifications (PRD §15.1, §15.3)", () => {
  it("plans tahajud, fajr, bedtime and al-kahfi inside 36 hours", () => {
    const p = planNotifications({ userId: U, now: NOW, tz: TZ, level: 1, prefs: prefs(), days: days("2026-11-12", "2026-11-13", "2026-11-14") });
    const got = p.items.map((i) => `${i.type}@${iso(i.scheduledAt)} for ${i.localDate}`);
    expect(got).toEqual([
      "alkahfi@2026-11-12T10:51:00.000Z for 2026-11-13", // Thursday Maghrib 17:51 WIB, dated by the Friday
      "bedtime@2026-11-12T14:30:00.000Z for 2026-11-13", // 22:00 minus 30 minutes, 21:30 WIB
      "tahajud@2026-11-12T19:56:00.000Z for 2026-11-13", // fajr 04:06 - (60 + 10) = 02:56 WIB
      "fajr@2026-11-12T21:06:00.000Z for 2026-11-13",
      "bedtime@2026-11-13T14:30:00.000Z for 2026-11-14",
    ]);
  });

  it("uses the dedupe key user:type:local_date (PRD §15.4)", () => {
    const p = planNotifications({ userId: U, now: NOW, tz: TZ, level: 1, prefs: prefs(), days: days("2026-11-13") });
    expect(p.items.find((i) => i.type === "fajr")?.dedupeKey).toBe(`${U}:fajr:2026-11-13`);
  });

  it("sets the expiry per type (bedtime 30, tahajud 15, fajr 20, al-kahfi 360 minutes)", () => {
    const p = planNotifications({ userId: U, now: NOW, tz: TZ, level: 1, prefs: prefs(), days: days("2026-11-13") });
    const mins = Object.fromEntries(p.items.map((i) => [i.type, (i.expiresAt.getTime() - i.scheduledAt.getTime()) / 60_000]));
    expect(mins).toMatchObject({ bedtime: 30, tahajud: 15, fajr: 20, alkahfi: 360 });
    const ttl = Object.fromEntries(p.items.map((i) => [i.type, i.ttlSeconds]));
    expect(ttl).toMatchObject({ tahajud: 900, fajr: 1200 });
  });

  it("moves the tahajud time with the level (duration 60/120/150 + 10 minutes buffer)", () => {
    const at = (level: 1 | 2 | 3) =>
      iso(planNotifications({ userId: U, now: NOW, tz: TZ, level, prefs: prefs(), days: days("2026-11-13") }).items.find((i) => i.type === "tahajud")!.scheduledAt);
    expect(at(1)).toBe("2026-11-12T19:56:00.000Z"); // 02:56 WIB
    expect(at(2)).toBe("2026-11-12T18:56:00.000Z"); // 01:56 WIB
    expect(at(3)).toBe("2026-11-12T18:26:00.000Z"); // 01:26 WIB
  });

  it("plans nothing for a type the user switched off (NOTIF-02)", () => {
    const p = planNotifications({
      userId: U,
      now: NOW,
      tz: TZ,
      level: 1,
      prefs: prefs({ bedtime: { enabled: false, target_sleep_time: "22:00", offset_minutes: 30 }, alkahfi: { enabled: false }, fajr: { enabled: false } }),
      days: days("2026-11-13", "2026-11-14"),
    });
    expect(p.items.map((i) => i.type)).toEqual(["tahajud"]);
  });

  it("drops times that already passed and times beyond 36 hours", () => {
    const late = new Date("2026-11-13T03:00:00+07:00"); // after tahajud 02:56, before fajr
    const p = planNotifications({ userId: U, now: late, tz: TZ, level: 1, prefs: prefs(), days: days("2026-11-13", "2026-11-14", "2026-11-15") });
    expect(p.items.map((i) => i.type + ":" + i.localDate)).toEqual([
      "fajr:2026-11-13",
      "bedtime:2026-11-14",
      "tahajud:2026-11-14",
      "fajr:2026-11-14",
      // bedtime for the 15th is 21:30 WIB on the 14th: past the 36 hour horizon (ends 15:00 WIB on the 14th)
    ]);
    const far = Math.max(...p.items.map((i) => i.scheduledAt.getTime()));
    expect(far).toBeLessThanOrEqual(late.getTime() + 36 * 3_600_000);
  });

  it("puts a target sleep time after midnight on the Fajr date, not 27 hours earlier", () => {
    const p = planNotifications({
      userId: U,
      now: NOW,
      tz: TZ,
      level: 1,
      prefs: prefs({ bedtime: { enabled: true, target_sleep_time: "01:00", offset_minutes: 0 } }),
      days: days("2026-11-13"),
    });
    expect(iso(p.items.find((i) => i.type === "bedtime")!.scheduledAt)).toBe("2026-11-12T18:00:00.000Z"); // 01:00 WIB on the 13th
  });

  it("reports dates with no schedule and plans nothing that needs one (BUG-04: nothing invented)", () => {
    const p = planNotifications({ userId: U, now: NOW, tz: TZ, level: 1, prefs: prefs({ alkahfi: { enabled: false } }), days: new Map() });
    expect(p.items).toEqual([]);
    expect(p.datesWithoutSchedule.length).toBeGreaterThan(0);
  });

  it("al-kahfi falls back to 18:00 when Thursday has no Maghrib (manual schedule)", () => {
    const manual = new Map([["2026-11-12", { fajrAt: new Date("2026-11-12T04:00:00+07:00"), maghribAt: null }]]);
    const p = planNotifications({ userId: U, now: NOW, tz: TZ, level: 1, prefs: prefs(), days: manual });
    expect(iso(p.items.find((i) => i.type === "alkahfi")!.scheduledAt)).toBe("2026-11-12T11:00:00.000Z");
  });

  it("does not plan al-kahfi on other weekdays", () => {
    const mon = new Date("2026-11-09T10:00:00+07:00");
    const p = planNotifications({ userId: U, now: mon, tz: TZ, level: 1, prefs: prefs(), days: days("2026-11-10", "2026-11-11") });
    expect(p.items.some((i) => i.type === "alkahfi")).toBe(false);
  });

  it("works in the other Indonesian zones (WITA, WIT)", () => {
    const wita = planNotifications({
      userId: U,
      now: new Date("2026-11-12T10:00:00+08:00"),
      tz: "Asia/Makassar",
      level: 1,
      prefs: prefs(),
      days: new Map([["2026-11-13", { fajrAt: new Date("2026-11-13T04:17:00+08:00"), maghribAt: null }]]),
    });
    expect(iso(wita.items.find((i) => i.type === "fajr")!.scheduledAt)).toBe("2026-11-12T20:17:00.000Z");
  });
});
