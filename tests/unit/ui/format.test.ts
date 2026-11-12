import { describe, expect, it } from "vitest";
import { addDaysISO } from "@/lib/dates";
import { dayOfMonth, formatClock, formatDuration, formatRate } from "@/lib/format-id";

describe("formatDuration", () => {
  it("never goes negative, so a passed Fajr reads as zero", () => {
    expect(formatDuration(-5 * 60_000)).toBe("0 menit");
  });
  it("uses hours and minutes", () => {
    expect(formatDuration(3 * 3_600_000 + 12 * 60_000)).toBe("3 jam 12 menit");
    expect(formatDuration(2 * 3_600_000)).toBe("2 jam");
    expect(formatDuration(45 * 60_000)).toBe("45 menit");
  });
});

describe("formatRate", () => {
  it("shows a friendly label when there is no denominator", () => {
    expect(formatRate(null)).toBe("Belum ada data");
  });
  it("keeps two decimals in Indonesian format", () => {
    expect(formatRate(57.14)).toBe("57,14%");
  });
});

describe("date helpers", () => {
  it("adds days across a month end without time zone drift", () => {
    expect(addDaysISO("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysISO("2026-11-13", 14)).toBe("2026-11-27");
  });
  it("reads the day of month from a date string", () => {
    expect(dayOfMonth("2026-11-05")).toBe(5);
  });
  it("formats a clock in the zone asked for", () => {
    expect(formatClock("2026-11-12T21:30:00Z", "Asia/Jakarta")).toBe("04.30");
    expect(formatClock("2026-11-12T21:30:00Z", "Asia/Jayapura")).toBe("06.30");
  });
});
