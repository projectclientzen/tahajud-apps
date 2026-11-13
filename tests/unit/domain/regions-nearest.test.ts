import { describe, expect, it } from "vitest";
import {
  haversineKm,
  inIndonesiaBox,
  locateRegion,
  nearestPlace,
  placesWithRegions,
  type Place,
  type RegionRef,
} from "@/domain/regions";
import crosscheck from "@content/regions/crosscheck-coordinates.json";
import equran from "@content/regions/equran-regions.json";

const PLACES: Place[] = crosscheck.regions.map((r) => ({ provinsi: r.provinsi, kabkota: r.kabkota, lat: r.lat, lon: r.lon }));
const by = (name: string) => PLACES.find((p) => p.kabkota === name)!;

describe("REGION-01 kota terdekat dari koordinat (haversine)", () => {
  it("jarak: titik sama = 0; satu derajat lintang sekitar 111 km; simetris", () => {
    const a = { lat: -6.2, lon: 106.8 };
    expect(haversineKm(a, a)).toBe(0);
    expect(haversineKm({ lat: 0, lon: 100 }, { lat: 1, lon: 100 })).toBeCloseTo(111.19, 1);
    const b = { lat: -7.25, lon: 112.75 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it("titik tepat di pusat sebuah wilayah memilih wilayah itu (502 wilayah, semuanya)", () => {
    for (const p of PLACES) {
      const hit = nearestPlace({ lat: p.lat, lon: p.lon }, PLACES);
      expect(hit?.distanceKm ?? 99, p.kabkota).toBeLessThan(0.001);
    }
  });

  it("titik sedikit bergeser dari Bandung, Makassar, dan Jayapura tetap memilih kota itu", () => {
    for (const name of ["Kota Bandung", "Kota Makassar", "Kota Jayapura"]) {
      const p = by(name);
      const hit = nearestPlace({ lat: p.lat + 0.01, lon: p.lon - 0.01 }, PLACES)!;
      expect(hit.place.kabkota).toBe(name);
      expect(hit.distanceKm).toBeLessThan(3);
    }
  });

  it("di tengah dua wilayah: memilih yang lebih dekat, dan bergeser ke sisi lain mengubah hasilnya", () => {
    const a = { provinsi: "X", kabkota: "A", lat: -6, lon: 100 };
    const b = { provinsi: "X", kabkota: "B", lat: -6, lon: 101 };
    expect(nearestPlace({ lat: -6, lon: 100.4 }, [a, b])!.place.kabkota).toBe("A");
    expect(nearestPlace({ lat: -6, lon: 100.6 }, [a, b])!.place.kabkota).toBe("B");
  });

  it("seri jarak memilih yang pertama dalam daftar", () => {
    const a = { provinsi: "X", kabkota: "A", lat: 0, lon: 100 };
    const b = { provinsi: "X", kabkota: "B", lat: 0, lon: 102 };
    expect(nearestPlace({ lat: 0, lon: 101 }, [a, b])!.place.kabkota).toBe("A");
    expect(nearestPlace({ lat: 0, lon: 101 }, [b, a])!.place.kabkota).toBe("B");
  });

  it("menolak titik tidak valid, di luar Indonesia, daftar kosong, dan yang terlalu jauh", () => {
    expect(nearestPlace({ lat: NaN, lon: 106 }, PLACES)).toBeNull();
    expect(nearestPlace({ lat: -6, lon: Infinity }, PLACES)).toBeNull();
    expect(nearestPlace({ lat: 91, lon: 106 }, PLACES)).toBeNull();
    expect(nearestPlace({ lat: 51.5, lon: -0.12 }, PLACES)).toBeNull(); // London
    expect(nearestPlace({ lat: -6, lon: 106 }, [])).toBeNull();
    expect(inIndonesiaBox({ lat: 3.1, lon: 101.7 })).toBe(true); // box only: Kuala Lumpur is inside the rough box
    // Inside the box but 400+ km from the only candidate.
    const far = { provinsi: "X", kabkota: "Jauh", lat: -10, lon: 120 };
    expect(nearestPlace({ lat: -6, lon: 106 }, [far])).toBeNull();
    expect(nearestPlace({ lat: -6, lon: 106 }, [far], 5000)).not.toBeNull();
  });

  it("melewati wilayah tanpa koordinat yang tidak valid", () => {
    const bad = { provinsi: "X", kabkota: "Rusak", lat: NaN, lon: NaN };
    const ok = { provinsi: "X", kabkota: "Baik", lat: -6, lon: 106 };
    expect(nearestPlace({ lat: -6.1, lon: 106 }, [bad, ok])!.place.kabkota).toBe("Baik");
  });
});

describe("REGION-02 menghubungkan kota ke wilayah di aplikasi", () => {
  const regions: RegionRef[] = [
    { id: "r-bdg", name: "Kota Bandung" },
    { id: "r-mks", name: "Kota Makassar" },
    { id: "demo", name: "Contoh: Jakarta (WIB)", place: "Kota Jakarta" },
  ];

  it("hanya kota yang punya wilayah yang jadi kandidat; id wilayah ikut terbawa", () => {
    const c = placesWithRegions(PLACES, regions);
    expect(c.map((p) => [p.kabkota, p.regionId]).sort()).toEqual([
      ["Kota Bandung", "r-bdg"],
      ["Kota Jakarta", "demo"],
      ["Kota Makassar", "r-mks"],
    ]);
  });

  it("nama yang dipakai dua wilayah dibuang karena tidak bisa dibedakan", () => {
    const dup: RegionRef[] = [
      { id: "1", name: "Kota Bandung" },
      { id: "2", name: "Kota Bandung" },
    ];
    expect(placesWithRegions(PLACES, dup)).toEqual([]);
  });

  it("locateRegion: dekat Bandung memilih wilayah Bandung dan jaraknya kecil", () => {
    const b = by("Kota Bandung");
    const r = locateRegion({ lat: b.lat + 0.02, lon: b.lon }, PLACES, regions);
    expect(r).toMatchObject({ ok: true, match: { place: { kabkota: "Kota Bandung", regionId: "r-bdg" } } });
  });

  it("locateRegion: di luar Indonesia = outside_indonesia; tanpa kandidat yang cocok = no_match", () => {
    expect(locateRegion({ lat: 51.5, lon: -0.12 }, PLACES, regions)).toEqual({ ok: false, reason: "outside_indonesia" });
    const aceh = by("Kab. Aceh Barat");
    expect(locateRegion({ lat: aceh.lat, lon: aceh.lon }, PLACES, regions)).toEqual({ ok: false, reason: "no_match" });
    expect(locateRegion({ lat: aceh.lat, lon: aceh.lon }, PLACES, [])).toEqual({ ok: false, reason: "no_match" });
  });

  it("data: 517 wilayah EQuran, 502 punya koordinat, 15 tidak; nama unik sehingga pencocokan aman", () => {
    const all = Object.values(equran.regions).flat();
    expect(all).toHaveLength(517);
    expect(new Set(all).size).toBe(517);
    expect(PLACES).toHaveLength(502);
    expect(crosscheck.unmatched).toHaveLength(15);
    const names = new Set(all);
    for (const p of PLACES) expect(names.has(p.kabkota), p.kabkota).toBe(true);
  });
});
