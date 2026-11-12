import provinceTimezones from "@content/regions/province-timezones.json";
import coordinatesData from "@content/regions/crosscheck-coordinates.json";
import type { LatLon } from "./crosscheck";
import { PrayerError } from "./types";

const SEP = "::";
export const EQURAN_ATTRIBUTION = "Bimas Islam Kemenag RI via EQuran.id";

export function makeEquranRegionId(provinsi: string, kabkota: string): string {
  return `${provinsi}${SEP}${kabkota}`;
}

export function parseEquranRegionId(regionId: string): { provinsi: string; kabkota: string } {
  const i = regionId.indexOf(SEP);
  if (i <= 0 || i + SEP.length >= regionId.length) {
    throw new PrayerError("PROVIDER_FAILED", `Invalid EQuran region id: ${regionId}`);
  }
  return { provinsi: regionId.slice(0, i), kabkota: regionId.slice(i + SEP.length) };
}

export function timezoneForProvince(provinsi: string): string {
  const tz = (provinceTimezones.timezones as Record<string, string>)[provinsi];
  if (!tz) throw new PrayerError("PROVIDER_FAILED", `No timezone mapped for province: ${provinsi}`);
  return tz;
}

const coordinateIndex = new Map<string, LatLon>(
  coordinatesData.regions.map((r) => [makeEquranRegionId(r.provinsi, r.kabkota), { lat: r.lat, lon: r.lon }]),
);

/** Wikidata (CC0) coordinates, see content/regions/crosscheck-coordinates.json. Unmatched regions return null. */
export function crosscheckCoordinates(provinsi: string, kabkota: string): LatLon | null {
  return coordinateIndex.get(makeEquranRegionId(provinsi, kabkota)) ?? null;
}
