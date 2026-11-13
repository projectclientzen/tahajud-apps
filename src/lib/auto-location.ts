import { locateRegion, type LatLon, type Place, type RegionRef } from "@/domain/regions";

/**
 * Automatic location for onboarding (CHANGE-2026-11-13 M3). Runs on the device only.
 * The GPS point lives inside `autoLocate` for the time of one calculation: it is not returned, stored, logged or
 * sent. What comes out is the region the user can confirm, and the caller sends only that region's id.
 */
export type AutoLocateResult =
  | { kind: "found"; regionId: string; /** Provider name of the matched place, e.g. "Kota Bandung". */ place: string; provinsi: string }
  /** The user refused the permission. */
  | { kind: "denied" }
  /** No geolocation in this browser. */
  | { kind: "unavailable" }
  /** The position could not be read (no signal, timeout). */
  | { kind: "failed" }
  | { kind: "outside_indonesia" }
  /** A point in Indonesia but no region of the app is close enough, or the place has no coordinates. */
  | { kind: "no_match" };

export type PositionGetter = () => Promise<LatLon>;
export type PlaceLoader = () => Promise<readonly Place[]>;

class GeoError extends Error {
  constructor(readonly code: "denied" | "unavailable" | "failed") {
    super(code);
  }
}

/** One read of the browser position. Not high accuracy: a city centre is all that is needed, and it is faster. */
export const browserPosition: PositionGetter = () =>
  new Promise<LatLon>((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return reject(new GeoError("unavailable"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) => reject(new GeoError(e.code === 1 ? "denied" : "failed")),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 5 * 60_000 },
    );
  });

/** The coordinate list is only loaded when the user asks for automatic location. */
export const defaultPlaces: PlaceLoader = async () => {
  const data = (await import("@content/regions/crosscheck-coordinates.json")).default as {
    regions: { provinsi: string; kabkota: string; lat: number; lon: number }[];
  };
  return data.regions.map((r) => ({ provinsi: r.provinsi, kabkota: r.kabkota, lat: r.lat, lon: r.lon }));
};

export async function autoLocate(
  regions: readonly RegionRef[],
  getPosition: PositionGetter = browserPosition,
  loadPlaces: PlaceLoader = defaultPlaces,
): Promise<AutoLocateResult> {
  let point: LatLon;
  try {
    point = await getPosition();
  } catch (e) {
    return { kind: e instanceof GeoError ? e.code : "failed" };
  }
  let places: readonly Place[];
  try {
    places = await loadPlaces();
  } catch {
    return { kind: "failed" };
  }
  const r = locateRegion(point, places, regions);
  if (!r.ok) return { kind: r.reason === "outside_indonesia" ? "outside_indonesia" : "no_match" };
  return { kind: "found", regionId: r.match.place.regionId, place: r.match.place.kabkota, provinsi: r.match.place.provinsi };
}

export const AUTO_LOCATE_MESSAGE: Record<Exclude<AutoLocateResult["kind"], "found">, string> = {
  denied: "Izin lokasi tidak diberikan. Tidak apa-apa, pilih wilayahmu dari daftar di bawah.",
  unavailable: "Peramban ini tidak bisa membaca lokasi. Pilih wilayahmu dari daftar di bawah.",
  failed: "Lokasimu belum terbaca. Coba lagi, atau pilih wilayahmu dari daftar di bawah.",
  outside_indonesia: "Lokasimu terbaca di luar Indonesia. Pilih wilayah yang kamu pakai untuk jadwal Subuh dari daftar di bawah.",
  no_match: "Belum ada wilayah yang cocok dengan lokasimu. Pilih dari daftar di bawah.",
};
