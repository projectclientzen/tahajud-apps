import { describe, expect, it } from "vitest";
import equran from "@content/regions/equran-regions.json";
import crosscheck from "@content/regions/crosscheck-coordinates.json";
import wikidata from "@content/regions/wikidata-coordinates.json";
import {
  INDONESIA_BOUNDS,
  compactKey,
  inIndonesia,
  matchRegions,
  normalizeName,
  normalizeProvince,
  parseEquranName,
  parseSparqlBindings,
  parseWktPoint,
  type WikidataRegion,
} from "@/server/prayer/coordinates";
import { crosscheckCoordinates } from "@/server/prayer/regions";

const b = (qid: string, label: string, cls: string, extra: Record<string, string> = {}) => {
  const row: Record<string, { value: string }> = {
    item: { value: `http://www.wikidata.org/entity/${qid}` },
    itemLabel: { value: label },
    type: { value: `http://www.wikidata.org/entity/${cls}` },
  };
  for (const [k, v] of Object.entries(extra)) row[k] = { value: v };
  return row;
};

describe("parseWktPoint", () => {
  it("reads Point(lon lat)", () => {
    expect(parseWktPoint("Point(110.816666666 -7.566666666)")).toEqual({ lon: 110.816666666, lat: -7.566666666 });
  });
  it("rejects other shapes", () => {
    expect(parseWktPoint("Polygon((0 0))")).toBeNull();
    expect(parseWktPoint("Point(abc def)")).toBeNull();
  });
});

describe("parseSparqlBindings", () => {
  it("merges rows of one item and keeps codes and provinces", () => {
    const { items, skipped } = parseSparqlBindings([
      b("Q4803", "Surakarta", "Q3199141", { coord: "Point(110.8 -7.5)", kode: "3372", bps: "3372", provLabel: "Jawa Tengah" }),
      b("Q4803", "Surakarta", "Q3199141", { coord: "Point(110.8 -7.5)", kode: "3372", provLabel: "Java" }),
    ]);
    expect(skipped).toEqual([]);
    expect(items).toEqual([
      { qid: "Q4803", label: "Surakarta", kind: "kota", lat: -7.5, lon: 110.8, kemendagriCode: "3372", bpsCode: "3372", provinces: ["Java", "Jawa Tengah"] },
    ]);
  });
  it("skips items with no coordinate, several coordinates, or outside the Indonesia box", () => {
    const { items, skipped } = parseSparqlBindings([
      b("Q1", "A", "Q3191695"),
      b("Q2", "B", "Q3191695", { coord: "Point(100 -1)" }),
      b("Q2", "B", "Q3191695", { coord: "Point(101 -2)" }),
      b("Q3", "C", "Q3191695", { coord: "Point(10 50)" }),
      b("Q4", "D", "Q3191695", { coord: "Point(100 -1)" }),
    ]);
    expect(items.map((i) => i.qid)).toEqual(["Q4"]);
    expect(skipped.map((s) => s.qid).sort()).toEqual(["Q1", "Q2", "Q3"]);
  });
  it("leaves a code null when Wikidata gives conflicting values", () => {
    const { items } = parseSparqlBindings([
      b("Q9", "X", "Q3191695", { coord: "Point(100 -1)", kode: "1111" }),
      b("Q9", "X", "Q3191695", { coord: "Point(100 -1)", kode: "2222" }),
    ]);
    expect(items[0]!.kemendagriCode).toBeNull();
  });
});

describe("name normalization", () => {
  it("strips Kab./Kabupaten/Kota, case, spaces and punctuation", () => {
    expect(normalizeName("Kabupaten  Aceh Barat")).toBe("aceh barat");
    expect(normalizeName("Kab. Aceh Barat")).toBe("aceh barat");
    expect(normalizeName("KOTA Banda Aceh")).toBe("banda aceh");
    expect(normalizeName("Kota Administrasi Jakarta Pusat")).toBe("jakarta pusat");
    expect(normalizeName("Kab. Tolikara")).toBe("tolikara");
  });
  it("compares without spaces", () => {
    expect(compactKey(normalizeName("Kota Tanjung Pinang"))).toBe(compactKey(normalizeName("Tanjungpinang")));
  });
  it("reads kind from the EQuran name and rejects sub-area labels", () => {
    expect(parseEquranName("Kab. Bogor")).toEqual({ kind: "kabupaten", key: "bogor" });
    expect(parseEquranName("Kota Bogor")).toEqual({ kind: "kota", key: "bogor" });
    expect(parseEquranName("Pulau Midai Kab. Natuna")).toBeNull();
  });
  it("normalizes province labels for tie-breaking", () => {
    expect(normalizeProvince("D.I. Yogyakarta")).toBe(normalizeProvince("Daerah Istimewa Yogyakarta"));
    expect(normalizeProvince("Jawa Tengah")).toBe(normalizeProvince("Provinsi Jawa Tengah"));
  });
});

describe("matchRegions", () => {
  const w = (qid: string, label: string, kind: "kabupaten" | "kota", provinces: string[]): WikidataRegion => ({
    qid, label, kind, lat: -6, lon: 107, kemendagriCode: null, bpsCode: null, provinces,
  });
  const data = [
    w("Q10", "Bogor", "kabupaten", ["Jawa Barat"]),
    w("Q11", "Bogor", "kota", ["Jawa Barat"]),
    w("Q20", "Kabupaten Sorong", "kabupaten", ["Papua Barat Daya"]),
    w("Q30", "Tanjungpinang", "kota", ["Kepulauan Riau"]),
    w("Q40", "Dup", "kabupaten", ["Aceh"]),
    w("Q41", "Dup", "kabupaten", ["Bali"]),
  ];
  const eq = {
    "Jawa Barat": ["Kab. Bogor", "Kota Bogor"],
    "Papua Barat": ["Kab. Sorong", "Kab. Tidak Ada"],
    "Kepulauan Riau": ["Kota Tanjung Pinang", "Pekajang Kab. Lingga"],
    Aceh: ["Kab. Dup"],
    Lain: ["Kab. Dup"],
  };
  const res = matchRegions(eq, data);
  const find = (p: string, k: string) => res.find((r) => r.provinsi === p && r.kabkota === k)!;

  it("separates kabupaten and kota with the same name", () => {
    expect(find("Jawa Barat", "Kab. Bogor").qid).toBe("Q10");
    expect(find("Jawa Barat", "Kota Bogor").qid).toBe("Q11");
  });
  it("matches by name when unique and flags a province difference", () => {
    const m = find("Papua Barat", "Kab. Sorong");
    expect(m).toMatchObject({ status: "matched", qid: "Q20", provinceMismatch: true });
  });
  it("matches across spacing differences", () => {
    expect(find("Kepulauan Riau", "Kota Tanjung Pinang").qid).toBe("Q30");
  });
  it("uses province to break a tie, otherwise marks ambiguous without a guess", () => {
    expect(find("Aceh", "Kab. Dup")).toMatchObject({ status: "matched", method: "name+province", qid: "Q40" });
    const amb = find("Lain", "Kab. Dup");
    expect(amb.status).toBe("ambiguous");
    expect(amb.lat).toBeUndefined();
    expect(amb.candidates).toEqual(["Q40", "Q41"]);
  });
  it("marks missing names and sub-area labels unmatched with no coordinates", () => {
    for (const m of [find("Papua Barat", "Kab. Tidak Ada"), find("Kepulauan Riau", "Pekajang Kab. Lingga")]) {
      expect(m.status).toBe("unmatched");
      expect(m.lat).toBeUndefined();
    }
  });
});

describe("committed coordinate data", () => {
  const total = Object.values(equran.regions).reduce((n, l) => n + l.length, 0);

  it("accounts for every EQuran region exactly once", () => {
    expect(total).toBe(517);
    expect(crosscheck.regions.length + crosscheck.unmatched.length).toBe(total);
    const ids = [...crosscheck.regions, ...crosscheck.unmatched].map((r) => `${r.provinsi}::${r.kabkota}`);
    expect(new Set(ids).size).toBe(total);
    for (const r of [...crosscheck.regions, ...crosscheck.unmatched]) {
      expect((equran.regions as Record<string, string[]>)[r.provinsi]).toContain(r.kabkota);
    }
  });
  it("has no coordinate outside the Indonesia box", () => {
    expect(INDONESIA_BOUNDS).toEqual({ latMin: -11, latMax: 6, lonMin: 95, lonMax: 141.1 });
    for (const r of crosscheck.regions) expect(inIndonesia(r.lat, r.lon), `${r.provinsi} ${r.kabkota}`).toBe(true);
    for (const i of wikidata.items) expect(inIndonesia(i.lat, i.lon), i.qid).toBe(true);
  });
  it("does not reuse one Wikidata item for two regions", () => {
    const q = crosscheck.regions.map((r) => r.wikidata_id);
    expect(new Set(q).size).toBe(q.length);
  });
  it("records source, license, date and query in the raw file", () => {
    expect(wikidata.license).toMatch(/CC0/);
    expect(wikidata.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(wikidata.query).toContain("P625");
  });
  it("gives no coordinates to unmatched regions", () => {
    for (const u of crosscheck.unmatched) {
      expect(crosscheckCoordinates(u.provinsi, u.kabkota)).toBeNull();
    }
  });
  it("keeps the three original cities close to their old approximate coordinates (cross-check stays valid)", () => {
    const old = [
      ["DKI Jakarta", "Kota Jakarta", -6.21, 106.85],
      ["Sulawesi Selatan", "Kota Makassar", -5.15, 119.43],
      ["Papua", "Kota Jayapura", -2.53, 140.72],
    ] as const;
    for (const [p, k, lat, lon] of old) {
      const c = crosscheckCoordinates(p, k);
      expect(c, k).not.toBeNull();
      // 1.5 degrees of longitude is the 6 minute tolerance.
      expect(Math.abs(c!.lon - lon)).toBeLessThan(0.5);
      expect(Math.abs(c!.lat - lat)).toBeLessThan(0.5);
    }
  });
});
