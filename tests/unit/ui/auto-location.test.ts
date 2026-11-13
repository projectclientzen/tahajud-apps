import { describe, expect, it, vi } from "vitest";
import { autoLocate, AUTO_LOCATE_MESSAGE, type PlaceLoader, type PositionGetter } from "@/lib/auto-location";
import type { RegionRef } from "@/domain/regions";

const places: PlaceLoader = async () => [
  { provinsi: "Jawa Barat", kabkota: "Kota Bandung", lat: -6.921944, lon: 107.606944 },
  { provinsi: "Sulawesi Selatan", kabkota: "Kota Makassar", lat: -5.133056, lon: 119.413611 },
];
const regions: RegionRef[] = [
  { id: "r-bdg", name: "Kota Bandung" },
  { id: "r-mks", name: "Kota Makassar" },
];
const at = (lat: number, lon: number): PositionGetter => async () => ({ lat, lon });

describe("LOKASI otomatis: hitung di perangkat", () => {
  it("dekat Bandung: wilayah Bandung ditemukan, hasil hanya berisi id wilayah dan nama kota", async () => {
    const r = await autoLocate(regions, at(-6.9, 107.62), places);
    expect(r).toEqual({ kind: "found", regionId: "r-bdg", place: "Kota Bandung", provinsi: "Jawa Barat" });
    // No coordinate leaves the function.
    expect(JSON.stringify(r)).not.toMatch(/-6\.9|107\.62/);
    expect(Object.keys(r).sort()).toEqual(["kind", "place", "provinsi", "regionId"]);
  });

  it("posisi gagal dibaca (galat biasa) = failed, dan daftar koordinat tidak dimuat", async () => {
    const load = vi.fn(places);
    const r = await autoLocate(
      regions,
      async () => {
        throw new Error("signal lost");
      },
      load,
    );
    expect(r).toEqual({ kind: "failed" });
    expect(load).not.toHaveBeenCalled();
  });

  it("memetakan galat geolokasi: GeoError denied / unavailable dari browserPosition", async () => {
    const { browserPosition } = await import("@/lib/auto-location");
    // Node has no navigator.geolocation: unavailable.
    expect(await autoLocate(regions, browserPosition, places)).toEqual({ kind: "unavailable" });
    const g = (code: number) => {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { geolocation: { getCurrentPosition: (_ok: unknown, err: (e: { code: number }) => void) => err({ code }) } },
      });
    };
    g(1);
    expect(await autoLocate(regions, browserPosition, places)).toEqual({ kind: "denied" });
    g(2);
    expect(await autoLocate(regions, browserPosition, places)).toEqual({ kind: "failed" });
    g(3);
    expect(await autoLocate(regions, browserPosition, places)).toEqual({ kind: "failed" });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        geolocation: { getCurrentPosition: (ok: (p: { coords: { latitude: number; longitude: number } }) => void) => ok({ coords: { latitude: -6.9, longitude: 107.6 } }) },
      },
    });
    expect((await autoLocate(regions, browserPosition, places)).kind).toBe("found");
    Reflect.deleteProperty(globalThis, "navigator");
  });

  it("di luar Indonesia dan tidak ada wilayah yang cocok punya hasil sendiri", async () => {
    expect(await autoLocate(regions, at(51.5, -0.12), places)).toEqual({ kind: "outside_indonesia" });
    expect(await autoLocate([], at(-6.9, 107.6), places)).toEqual({ kind: "no_match" });
    // Aceh is in Indonesia but 1600+ km from both candidates.
    expect(await autoLocate(regions, at(4.5, 96.2), places)).toEqual({ kind: "no_match" });
  });

  it("daftar koordinat gagal dimuat = failed", async () => {
    expect(await autoLocate(regions, at(-6.9, 107.6), async () => { throw new Error("chunk"); })).toEqual({ kind: "failed" });
  });

  it("setiap pesan fallback tanpa em-dash dan mengarah ke pilihan manual", () => {
    for (const m of Object.values(AUTO_LOCATE_MESSAGE)) {
      expect(m).not.toContain("—");
      expect(m).toMatch(/daftar di bawah/);
    }
  });
});
