import amalan from "@content/amalan.v1.json";
import { describe, expect, it } from "vitest";

type Activity = { activity_key: string; type: string; target?: number; required: boolean };
type Level = { level: number; night: Activity[]; fajr: Activity[]; post_fajr: Activity[] };
const levels = amalan.levels as unknown as Level[];

const sum = (xs: Activity[], type: string, requiredOnly = true) =>
  xs.filter((a) => a.type === type && (!requiredOnly || a.required)).reduce((n, a) => n + (a.target ?? 0), 0);

describe("content/amalan.v1.json (owner content, PRD v1.2 §9)", () => {
  it.each([
    [1, 400, 5],
    [2, 1550, 9],
    [3, 1863, 11],
  ])("level %i: night dhikr %i, rakaat %i", (lv, dhikr, rakaat) => {
    const L = levels.find((l) => l.level === lv)!;
    expect(sum(L.night, "dhikr")).toBe(dhikr);
    expect(sum(L.night, "prayer", false)).toBe(rakaat);
  });

  it("post-Fajr applies to every level and Al-Waqi'ah is required", () => {
    for (const L of levels) {
      const waqiah = L.post_fajr.find((a) => a.activity_key === "pf_al_waqiah");
      expect(waqiah?.required).toBe(true);
    }
  });

  it("night tilawah is optional", () => {
    for (const L of levels) {
      expect(L.night.find((a) => a.activity_key === "tilawah")?.required).toBe(false);
    }
  });

  it("every dhikr reference resolves to Arabic text supplied by the owner", () => {
    const dhikr = amalan.dhikr as Record<string, { arabic_text: string }>;
    for (const L of levels) {
      for (const a of [...L.night, ...L.fajr, ...L.post_fajr]) {
        if (a.type !== "dhikr") continue;
        const ref = (a as Activity & { dhikr_ref: string }).dhikr_ref;
        expect(dhikr[ref]?.arabic_text, ref).toBeTruthy();
      }
    }
  });

  it("asma uses Ya Kafi in standard Arabic letters (no presentation forms)", () => {
    const text = amalan.dhikr.asma_rangkaian.arabic_text;
    expect(text).toContain("كافي");
    expect(/[ﭐ-﷿ﹰ-﻿]/.test(text)).toBe(false);
  });
});
