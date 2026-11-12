import { CalculationMethod, Coordinates, PrayerTimes } from "adhan";
import type { EquranDayRow } from "./equran-schema";
import { localToUtcIso } from "./time";

/**
 * Independent astronomical check of Fajr and Maghrib.
 * Parameters: adhan CalculationMethod.Singapore() = Fajr 20 deg, Isha 18 deg
 * (adhan METHODS.md lists it as the method for Indonesia, Malaysia, Singapore).
 * Kemenag also adds ihtiyath of about 2 minutes. That is not applied here, and the
 * 6 minute threshold (PROV) absorbs it.
 */
export const CROSSCHECK_THRESHOLD_MINUTES = 6;

export interface CrossCheckRow {
  date: string;
  fajrDiffMin: number;
  maghribDiffMin: number;
  adhanFajr: string;
  adhanMaghrib: string;
}

export interface CrossCheckResult {
  rows: CrossCheckRow[];
  maxDiffMin: number;
  withinThreshold: boolean;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export function crossCheckMonth(
  rows: readonly EquranDayRow[],
  year: number,
  month: number,
  timezone: string,
  at: LatLon,
  thresholdMin = CROSSCHECK_THRESHOLD_MINUTES,
): CrossCheckResult {
  const params = CalculationMethod.Singapore();
  const coords = new Coordinates(at.lat, at.lon);
  const out: CrossCheckRow[] = rows.map((row) => {
    // adhan reads year/month/day from the Date in the process timezone, so build it the same way.
    const pt = new PrayerTimes(coords, new Date(year, month - 1, row.tanggal), params);
    const apiFajr = new Date(localToUtcIso(row.tanggal_lengkap, row.subuh, timezone)).getTime();
    const apiMaghrib = new Date(localToUtcIso(row.tanggal_lengkap, row.maghrib, timezone)).getTime();
    return {
      date: row.tanggal_lengkap,
      fajrDiffMin: (apiFajr - pt.fajr.getTime()) / 60000,
      maghribDiffMin: (apiMaghrib - pt.maghrib.getTime()) / 60000,
      adhanFajr: pt.fajr.toISOString(),
      adhanMaghrib: pt.maghrib.toISOString(),
    };
  });
  const maxDiffMin = out.reduce((m, r) => Math.max(m, Math.abs(r.fajrDiffMin), Math.abs(r.maghribDiffMin)), 0);
  return { rows: out, maxDiffMin, withinThreshold: maxDiffMin <= thresholdMin };
}
