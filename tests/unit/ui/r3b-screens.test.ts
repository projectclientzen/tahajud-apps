import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { csLink } from "@/components/help/help-view";
import { pushState } from "@/components/notifications/push-support";
import { monthGrid, shiftMonth, monthEnd } from "@/components/reports/month";
import { ReportBody } from "@/components/reports/report-view";
import { ayahCount, readCount, SURAHS, surahByNumber } from "@/components/quran/surahs";
import { loadSurahText } from "@/components/quran/text-source";
import { parsePlannerPrefs, defaultPlannerPrefs } from "@/components/settings/planner-prefs";
import { buildPlannerPreview } from "@/components/settings/planner-preview";
import { formatRelative } from "@/components/settings/relative-time";
import { StatusChip } from "@/components/ui/status-chip";
import { completionRate, statusCounts } from "@/domain";
import { DISPLAY_STATUS_LABEL } from "@/domain/content/session-status";
import type { ReportResponse } from "@/data";

// Vitest compiles TSX with the classic runtime, so JSX files need React in scope.
(globalThis as { React?: typeof React }).React = React;

const day = (status: "completed" | "partial" | "missed", i: number) => ({
  date: `2026-11-${String(i + 1).padStart(2, "0")}`,
  status,
  level: 1 as const,
  hasProgress: true,
});

function reportFrom(statuses: ("completed" | "partial" | "missed")[]): ReportResponse {
  const days = statuses.map((s, i) => day(s, i));
  return {
    period: 7,
    from: null,
    to: null,
    status_counts: statusCounts(days),
    completion_rate: completionRate(days),
    activity_statistics: [],
    insight: null,
  };
}

describe("REPORT-01 di UI: 4 tuntas, 2 sebagian, 1 terlewat", () => {
  it("menampilkan 57,14%", () => {
    const html = renderToStaticMarkup(
      createElement(ReportBody, {
        report: reportFrom(["completed", "completed", "completed", "completed", "partial", "partial", "missed"]),
      }),
    );
    expect(html).toContain("57,14%");
  });
  it("REPORT-02: penyebut 0 menampilkan Belum ada data, bukan 0%", () => {
    const html = renderToStaticMarkup(createElement(ReportBody, { report: reportFrom([]) }));
    expect(html).toContain("Belum ada data");
    expect(html).not.toContain("0%");
  });
});

describe("label Sedang berjalan", () => {
  it("ada di label status dan StatusChip memakai ikon yang berbeda", () => {
    expect(DISPLAY_STATUS_LABEL.in_progress).toBe("Sedang berjalan");
    const html = renderToStaticMarkup(createElement(StatusChip, { status: "in_progress" }));
    expect(html).toContain("Sedang berjalan");
    const icons = new Set(
      (["completed", "partial", "missed", "excused", "upcoming", "in_progress"] as const).map(
        (s) => renderToStaticMarkup(createElement(StatusChip, { status: s })).match(/<svg.*?<\/svg>/)![0],
      ),
    );
    expect(icons.size).toBe(6);
  });
});

describe("QURAN-01 (metadata): jumlah ayat dan rentang At-Talaq", () => {
  it("cocok dengan PRD §13.1", () => {
    const counts = Object.fromEntries(SURAHS.map((s) => [s.number, ayahCount(s)]));
    expect(counts).toMatchObject({ 36: 83, 56: 96, 67: 30, 55: 78, 18: 110, 65: 2 });
    expect(surahByNumber(65)).toMatchObject({ first: 2, last: 3 });
    expect(readCount(surahByNumber(65)!, 3)).toBe(2);
    expect(readCount(surahByNumber(36)!, null)).toBe(0);
  });
  it("tanpa dataset, sumber teks mengembalikan null", async () => {
    expect(await loadSurahText(36)).toBeNull();
  });
});

describe("kalender bulan", () => {
  it("Nov 2026: Minggu pertama diawali padding, 30 hari, baris penuh 7", () => {
    const g = monthGrid("2026-11");
    expect(g.length % 7).toBe(0);
    expect(g.filter(Boolean)).toHaveLength(30);
    expect(g.indexOf("2026-11-01")).toBe(6); // 1 Nov 2026 jatuh pada hari Minggu
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
  });
});

describe("planner preview", () => {
  it("pakai durasi dan buffer pengguna, peringatan tidur netral", () => {
    const prefs = { ...defaultPlannerPrefs(), bufferMinutes: 20 };
    const fajr = new Date("2026-11-13T04:30:00+07:00");
    const p = buildPlannerPreview({ fajrAt: fajr, tz: "Asia/Jakarta", level: 1, prefs, targetSleep: "22:00" });
    expect(p.wakeAt.toISOString()).toBe(new Date("2026-11-13T03:10:00+07:00").toISOString());
    expect(p.sleepWarning).toBeNull();
    const short = buildPlannerPreview({ fajrAt: fajr, tz: "Asia/Jakarta", level: 1, prefs, targetSleep: "00:30" });
    expect(short.sleepWarning).toContain("tidur");
  });
  it("nilai rusak kembali ke default", () => {
    expect(parsePlannerPrefs("{bad")).toEqual(defaultPlannerPrefs());
    expect(parsePlannerPrefs(JSON.stringify({ durations: { 1: 5 }, bufferMinutes: 999 }))).toEqual(
      defaultPlannerPrefs(),
    );
    expect(parsePlannerPrefs(JSON.stringify({ durations: { 1: 90 }, bufferMinutes: 15 })).durations[1]).toBe(90);
  });
});

describe("NOTIF-03: dukungan push", () => {
  const base = {
    hasPushManager: true,
    hasNotification: true,
    platform: "desktop-chromium",
    standalone: false,
    permission: "default",
  } as const;
  it("tanpa PushManager menjadi unsupported", () =>
    expect(pushState({ ...base, hasPushManager: false })).toBe("unsupported"));
  it("iOS belum dipasang meminta install", () =>
    expect(pushState({ ...base, platform: "ios-safari" })).toBe("needs_install"));
  it("iOS terpasang boleh meminta izin", () =>
    expect(pushState({ ...base, platform: "ios-safari", standalone: true })).toBe("can_ask"));
  it("izin ditolak dan diberikan", () => {
    expect(pushState({ ...base, permission: "denied" })).toBe("denied");
    expect(pushState({ ...base, permission: "granted" })).toBe("granted");
  });
});

describe("util kecil", () => {
  it("formatRelative", () => {
    const now = Date.parse("2026-11-12T12:00:00Z");
    expect(formatRelative("2026-11-12T11:59:00Z", now)).toBe("Baru saja");
    expect(formatRelative("2026-11-12T09:00:00Z", now)).toBe("3 jam lalu");
    expect(formatRelative("2026-11-09T12:00:00Z", now)).toBe("3 hari lalu");
  });
  it("csLink hanya angka, kosong disembunyikan", () => {
    expect(csLink("+62 812-3456")).toBe("https://wa.me/628123456");
    expect(csLink("")).toBeNull();
    expect(csLink(undefined)).toBeNull();
  });
});

describe("tidak ada teks Arab di src/", () => {
  it("grep aksara Arab = 0", () => {
    const re = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (re.test(readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk("src");
    expect(hits).toEqual([]);
  });
});
