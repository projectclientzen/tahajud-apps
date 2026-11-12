import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SCHEDULE_ATTRIBUTION, ScheduleNote, scheduleNote } from "@/components/settings/schedule-note";
import type { PrayerTime } from "@/data";

(globalThis as { React?: typeof React }).React = React;

const base: PrayerTime = {
  available: true,
  region_id: "r1",
  region_name: "Contoh",
  local_date: "2026-11-13",
  timezone: "Asia/Jakarta",
  fajr_at: "2026-11-12T21:00:00Z",
  maghrib_at: null,
  source: "provider",
  cache_status: "fresh",
  fetched_at: "2026-11-12T10:00:00Z",
  label: "Jadwal terkini",
  demo_note: null,
};

const html = (p: PrayerTime) => renderToStaticMarkup(createElement(ScheduleNote, { fajr: p }));

describe("label jadwal: terverifikasi hanya jika verification === verified", () => {
  it("verified menampilkan Terverifikasi dan atribusi Kemenag via EQuran.id", () => {
    const out = html({ ...base, verification: "verified" });
    expect(out).toContain("Terverifikasi");
    expect(out).toContain("Bimas Islam Kemenag RI via EQuran.id");
    expect(SCHEDULE_ATTRIBUTION).toBe("Bimas Islam Kemenag RI via EQuran.id");
  });

  it.each([
    ["needs_review", "Perlu dicek ulang"],
    ["unchecked", "Belum diverifikasi"],
    [undefined, "Belum diverifikasi"],
    [null, "Belum diverifikasi"],
  ] as const)("%s tidak pernah tampil sebagai terverifikasi", (verification, text) => {
    const out = html({ ...base, verification });
    expect(out).toContain(text);
    expect(out).not.toMatch(/Terverifikasi/);
    // The provider schedule still carries its attribution.
    expect(out).toContain("Bimas Islam Kemenag RI via EQuran.id");
  });

  it("jadwal tersimpan (cached) mengikuti aturan yang sama", () => {
    expect(
      scheduleNote({ ...base, source: "cached", label: "Jadwal tersimpan", verification: "verified" }),
    ).toMatchObject({
      verification: "verified",
      attribution: SCHEDULE_ATTRIBUTION,
    });
  });

  it("data demo: tanpa atribusi Kemenag dan tidak pernah terverifikasi, catatan demo tampil", () => {
    const n = scheduleNote({ ...base, demo_note: "Jadwal contoh, bukan dari Kemenag" });
    expect(n.attribution).toBeNull();
    expect(n.verification).toBe("unverified");
    const out = html({ ...base, demo_note: "Jadwal contoh, bukan dari Kemenag", verification: "verified" });
    expect(out).toContain("Jadwal contoh, bukan dari Kemenag");
    expect(out).not.toContain("Bimas Islam");
  });

  it("jadwal manual: tanpa label verifikasi dan tanpa atribusi", () => {
    const n = scheduleNote({ ...base, source: "manual", label: "Diatur manual", verification: "verified" });
    expect(n).toMatchObject({ verification: null, attribution: null, source: "Diatur manual" });
  });

  it("jadwal tidak tersedia", () => {
    const n = scheduleNote({ ...base, available: false, source: null, label: null });
    expect(n).toMatchObject({ source: "Jadwal belum tersedia", verification: null, attribution: null });
  });
});
