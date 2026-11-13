/**
 * Nearest regency or city to a GPS point (CHANGE-2026-11-13 M3). Pure. The point is used for this calculation only:
 * nothing here stores, logs or returns it, and callers must not send it anywhere. Only the chosen region id leaves
 * the device.
 *
 * Distances are great-circle (haversine) from the place's centre point. A point near the border of two regions can
 * land on the wrong one, so the UI always asks the user to confirm.
 */
export interface LatLon {
  lat: number;
  lon: number;
}

export interface Place extends LatLon {
  /** Province name as the prayer-time provider writes it. */
  provinsi: string;
  /** Regency or city name as the provider writes it, for example "Kota Bandung". */
  kabkota: string;
}

export interface Nearest<P extends Place = Place> {
  place: P;
  distanceKm: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

/** Same box as src/server/prayer/coordinates.ts INDONESIA_BOUNDS. */
export const INDONESIA_BOX = { latMin: -11, latMax: 6, lonMin: 95, lonMax: 141.1 } as const;

export function isValidPoint(p: LatLon): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
}

export function inIndonesiaBox(p: LatLon): boolean {
  return (
    isValidPoint(p) &&
    p.lat >= INDONESIA_BOX.latMin &&
    p.lat <= INDONESIA_BOX.latMax &&
    p.lon >= INDONESIA_BOX.lonMin &&
    p.lon <= INDONESIA_BOX.lonMax
  );
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * PROVISIONAL guard: farther than this from every candidate means "no reliable match" and the UI falls back to the
 * manual list. It only protects against a far-away or wrong point. Large regencies (Papua, Kalimantan) can be
 * well over 100 km across, so the value is generous.
 */
export const MAX_MATCH_KM = 300;

/**
 * The closest candidate, or null when the point is invalid, outside Indonesia, there are no candidates, or the
 * closest one is farther than `maxKm`. Ties go to the first candidate in the list.
 */
export function nearestPlace<P extends Place>(
  point: LatLon,
  places: readonly P[],
  maxKm: number = MAX_MATCH_KM,
): Nearest<P> | null {
  if (!inIndonesiaBox(point)) return null;
  let best: Nearest<P> | null = null;
  for (const place of places) {
    if (!isValidPoint(place)) continue;
    const d = haversineKm(point, place);
    if (best === null || d < best.distanceKm) best = { place, distanceKm: d };
  }
  return best !== null && best.distanceKm <= maxKm ? best : null;
}

/** A region the user can choose in the app. `place` is the provider's regency/city name when it differs from `name`. */
export interface RegionRef {
  id: string;
  name: string;
  place?: string | null;
}

export type PlaceWithRegion = Place & { regionId: string };

/**
 * Keeps only the places the app has a region for, and attaches that region's id. A name used by two regions is
 * dropped (it cannot be told apart), and so is a place no region carries. Matching is on the provider name, exactly.
 */
export function placesWithRegions(places: readonly Place[], regions: readonly RegionRef[]): PlaceWithRegion[] {
  const byName = new Map<string, string | null>();
  for (const r of regions) {
    const key = r.place ?? r.name;
    byName.set(key, byName.has(key) ? null : r.id);
  }
  const out: PlaceWithRegion[] = [];
  for (const p of places) {
    const id = byName.get(p.kabkota);
    if (id) out.push({ ...p, regionId: id });
  }
  return out;
}

export type LocateFailure = "outside_indonesia" | "no_match";

/** Whole step, from a point to a region the user can confirm. */
export function locateRegion(
  point: LatLon,
  places: readonly Place[],
  regions: readonly RegionRef[],
  maxKm: number = MAX_MATCH_KM,
): { ok: true; match: Nearest<PlaceWithRegion> } | { ok: false; reason: LocateFailure } {
  if (!inIndonesiaBox(point)) return { ok: false, reason: "outside_indonesia" };
  const match = nearestPlace(point, placesWithRegions(places, regions), maxKm);
  return match ? { ok: true, match } : { ok: false, reason: "no_match" };
}
