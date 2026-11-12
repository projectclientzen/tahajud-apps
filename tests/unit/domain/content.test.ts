import amalan from "@content/amalan.v1.json";
import { describe, expect, it } from "vitest";
import { getAmalan, getLevelConfig, nightDhikrTotal, nightRakaatTotal, parseAmalan } from "@/domain/content/amalan";
import { createSessionSnapshot } from "@/domain/content/snapshot";
import { PROVISIONAL_SETTINGS, PROVISIONAL_ITEMS } from "@/domain/config/provisional";

describe("config: provisional settings (snapshot of PRD v1.2 §30.2)", () => {
  it("keeps every default provisional and unchanged", () => {
    expect(PROVISIONAL_SETTINGS).toMatchInlineSnapshot(`
      {
        "alKahfiFallbackMaghrib": "18:00",
        "bedtimeAvoidLast": 14,
        "bedtimeBankMinimum": 30,
        "correctionWindowHours": 48,
        "cutoff": {
          "hour": 12,
          "minute": 0,
        },
        "excuseMaxDaysPerAction": 15,
        "levels": {
          "1": {
            "estimatedDurationMinutes": 60,
            "requiredSuccessfulNights": 7,
            "suggestedPeriodNights": 14,
          },
          "2": {
            "estimatedDurationMinutes": 120,
            "requiredSuccessfulNights": 12,
            "suggestedPeriodNights": 21,
          },
          "3": {
            "estimatedDurationMinutes": 150,
            "requiredSuccessfulNights": 20,
            "suggestedPeriodNights": 30,
          },
        },
        "minSleepHours": 5,
        "notificationExpiryMinutes": {
          "achievement": 1440,
          "alkahfi": 360,
          "bedtime": 30,
          "fajr": 20,
          "tahajud": 15,
        },
        "provisional": true,
        "wakeBufferMinutes": 10,
      }
    `);
    expect(PROVISIONAL_SETTINGS.provisional).toBe(true);
    expect(PROVISIONAL_ITEMS.length).toBeGreaterThan(5);
  });
});

describe("content: loader from content/amalan.v1.json", () => {
  it.each([
    [1, 400, 5],
    [2, 1550, 9],
    [3, 1863, 11],
  ] as const)("level %i totals: dhikr %i, rakaat %i", (lv, dhikr, rakaat) => {
    const cfg = getLevelConfig(lv);
    expect(nightDhikrTotal(cfg)).toBe(dhikr);
    expect(nightRakaatTotal(cfg)).toBe(rakaat);
  });

  it("keeps Arabic text byte-for-byte from the owner file", () => {
    const content = getAmalan();
    const raw = amalan.dhikr as Record<string, { arabic_text: string }>;
    for (const [k, v] of Object.entries(content.dhikr)) expect(v.arabicText).toBe(raw[k]!.arabic_text);
  });

  it("leaves transliteration and meaning null (owner has not supplied them)", () => {
    for (const d of Object.values(getAmalan().dhikr)) {
      expect(d.transliteration).toBeNull();
      expect(d.meaningId).toBeNull();
    }
  });

  it("gives night and post-fajr 'tahlil' different ids", () => {
    const ids = getLevelConfig(1)
      .activities.filter((a) => a.key === "tahlil")
      .map((a) => a.id);
    expect(ids.sort()).toEqual(["night:tahlil", "post_fajr:tahlil"]);
  });

  it("treats only dhikr as counters", () => {
    for (const a of getLevelConfig(2).activities) expect(a.kind).toBe(a.type === "dhikr" ? "counter" : "checklist");
  });

  it("marks optional items as not required (night tilawah, tahlil tambahan)", () => {
    const l1 = getLevelConfig(1).activities;
    expect(l1.find((a) => a.id === "night:tilawah")?.required).toBe(false);
    expect(l1.find((a) => a.id === "night:tahlil_tambahan")?.required).toBe(false);
    expect(l1.find((a) => a.id === "post_fajr:pf_al_waqiah")?.required).toBe(true);
  });

  it("rejects a dhikr activity without Arabic text", () => {
    const broken = structuredClone(amalan) as unknown as { levels: { night: { dhikr_ref?: string }[] }[] };
    const item = broken.levels[0]!.night.find((a) => a.dhikr_ref)!;
    item.dhikr_ref = "does_not_exist";
    expect(() => parseAmalan(broken)).toThrow(/no dhikr text/);
  });

  it("rejects duplicate activity ids within a level", () => {
    const broken = structuredClone(amalan) as unknown as { levels: { night: unknown[] }[] };
    broken.levels[0]!.night.push(broken.levels[0]!.night[0]!);
    expect(() => parseAmalan(broken)).toThrow(/duplicate/);
  });
});

describe("content: session snapshot", () => {
  it("LEVEL-05 freezes targets: editing config later does not change an existing snapshot", () => {
    const content = parseAmalan(structuredClone(amalan));
    const snap = createSessionSnapshot(
      {
        sessionKey: "2026-11-13",
        level: 1,
        timezone: "Asia/Jakarta",
        regionId: "jkt",
        now: new Date("2026-11-12T20:00:00Z"),
      },
      content,
    );
    const before = snap.activities.find((a) => a.id === "night:istighfar")!.target;
    content.levels[1].activities.find((a) => a.id === "night:istighfar")!.target = 999;
    expect(snap.activities.find((a) => a.id === "night:istighfar")!.target).toBe(before);
    expect(before).toBe(100);
    expect(snap).toMatchObject({ level: 1, timezone: "Asia/Jakarta", regionId: "jkt", contentVersion: "1.1.0" });
  });
});
