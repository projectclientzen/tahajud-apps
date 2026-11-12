/**
 * Wikidata (CC0) coordinates for EQuran regencies/cities.
 * Pure functions: SPARQL result parsing, name normalization, matching.
 * No network and no file access here, see scripts/import-coordinates.ts.
 */

export const INDONESIA_BOUNDS = { latMin: -11, latMax: 6, lonMin: 95, lonMax: 141.1 } as const;

export type RegionKind = "kabupaten" | "kota";

export const WIKIDATA_CLASS_TO_KIND: Record<string, RegionKind> = {
  Q3191695: "kabupaten",
  Q3199141: "kota",
};

export interface WikidataRegion {
  qid: string;
  label: string;
  kind: RegionKind;
  lat: number;
  lon: number;
  /** P2588, Kemendagri administrative code. */
  kemendagriCode: string | null;
  /** P1588, BPS area code. */
  bpsCode: string | null;
  /** Province labels reached through P131 (may hold several after 2022 splits). */
  provinces: string[];
}

export interface ParseResult {
  items: WikidataRegion[];
  /** Items skipped on purpose, with reason. Nothing is dropped silently. */
  skipped: { qid: string; reason: string }[];
}

type Binding = Record<string, { value: string } | undefined>;

export function inIndonesia(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= INDONESIA_BOUNDS.latMin &&
    lat <= INDONESIA_BOUNDS.latMax &&
    lon >= INDONESIA_BOUNDS.lonMin &&
    lon <= INDONESIA_BOUNDS.lonMax
  );
}

/** Wikidata WKT is "Point(lon lat)". */
export function parseWktPoint(wkt: string): { lat: number; lon: number } | null {
  const m = /^Point\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i.exec(wkt.trim());
  if (!m) return null;
  return { lon: Number(m[1]), lat: Number(m[2]) };
}

export function qidFromUri(uri: string): string | null {
  const m = /\/entity\/(Q\d+)$/.exec(uri);
  return m ? (m[1] ?? null) : null;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function parseSparqlBindings(bindings: readonly Binding[]): ParseResult {
  const byQid = new Map<
    string,
    {
      label: string;
      kind: RegionKind;
      coords: Map<string, { lat: number; lon: number }>;
      kemendagri: Set<string>;
      bps: Set<string>;
      provinces: Set<string>;
    }
  >();
  const skipped: { qid: string; reason: string }[] = [];

  for (const b of bindings) {
    const qid = b.item ? qidFromUri(b.item.value) : null;
    const kindQid = b.type ? /(Q\d+)$/.exec(b.type.value)?.[1] : undefined;
    const kind = kindQid ? WIKIDATA_CLASS_TO_KIND[kindQid] : undefined;
    if (!qid || !kind) {
      skipped.push({ qid: qid ?? "?", reason: "missing item or unknown class" });
      continue;
    }
    let e = byQid.get(qid);
    if (!e) {
      e = {
        label: b.itemLabel?.value ?? "",
        kind,
        coords: new Map(),
        kemendagri: new Set(),
        bps: new Set(),
        provinces: new Set(),
      };
      byQid.set(qid, e);
    }
    if (b.coord) {
      const p = parseWktPoint(b.coord.value);
      if (p) e.coords.set(`${round6(p.lat)},${round6(p.lon)}`, { lat: round6(p.lat), lon: round6(p.lon) });
    }
    if (b.kode?.value) e.kemendagri.add(b.kode.value);
    if (b.bps?.value) e.bps.add(b.bps.value);
    if (b.provLabel?.value) e.provinces.add(b.provLabel.value);
  }

  const items: WikidataRegion[] = [];
  for (const [qid, e] of byQid) {
    if (e.coords.size === 0) {
      skipped.push({ qid, reason: "no coordinate (P625)" });
      continue;
    }
    if (e.coords.size > 1) {
      skipped.push({ qid, reason: "several different coordinates, not chosen by guess" });
      continue;
    }
    const c = [...e.coords.values()][0]!;
    if (!inIndonesia(c.lat, c.lon)) {
      skipped.push({ qid, reason: `coordinate outside Indonesia box (${c.lat}, ${c.lon})` });
      continue;
    }
    items.push({
      qid,
      label: e.label,
      kind: e.kind,
      lat: c.lat,
      lon: c.lon,
      kemendagriCode: e.kemendagri.size === 1 ? [...e.kemendagri][0]! : null,
      bpsCode: e.bps.size === 1 ? [...e.bps][0]! : null,
      provinces: [...e.provinces].sort(),
    });
  }
  items.sort((a, b) => a.qid.localeCompare(b.qid, "en", { numeric: true }));
  return { items, skipped };
}

/** "Kab. Aceh Barat" -> kabupaten; "Kota Banda Aceh" -> kota; anything else -> null. */
export function parseEquranName(name: string): { kind: RegionKind; key: string } | null {
  const trimmed = name.trim();
  const m = /^(Kab\.|Kabupaten|Kota)\s+(.+)$/i.exec(trimmed);
  if (!m) return null;
  const kind: RegionKind = /^kota$/i.test(m[1]!) ? "kota" : "kabupaten";
  return { kind, key: normalizeName(m[2]!) };
}

/** Lowercase, strip diacritics and punctuation, collapse spaces, drop kab/kota/administrasi prefixes. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[.,'’`()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(kabupaten|kab|kota administrasi|kota adm|kota)\s+/, "")
    .replace(/^administrasi\s+/, "")
    .trim();
}

/** Spacing differs between sources ("Tanjung Pinang" vs "Tanjungpinang"), so compare without spaces. */
export function compactKey(normalized: string): string {
  return normalized.replace(/\s+/g, "");
}

/** Province labels differ between EQuran and Wikidata. Only used to break ties. */
export function normalizeProvince(name: string): string {
  const n = normalizeName(name)
    .replace(/^(provinsi|province of|daerah istimewa|special region of|special capital region of|daerah khusus ibukota)\s+/, "")
    .replace(/^d i\s+/, "")
    .replace(/^dki\s+/, "")
    .trim();
  return n;
}

/**
 * Explicit overrides, decided by a person (not by the matcher).
 * EQuran "Kota Jakarta" is the whole capital region; Wikidata Q3630 "Jakarta" has a coordinate
 * but is a province-level item, so it never matches by name and class.
 * Remove this entry if the owner prefers Jakarta stays unmatched.
 */
export const MANUAL_QID_OVERRIDES: Record<string, { qid: string; reason: string }> = {
  "DKI Jakarta::Kota Jakarta": {
    qid: "Q3630",
    reason: "EQuran lists one 'Kota Jakarta' for the whole capital region; Wikidata Q3630 is Jakarta (province-level).",
  },
};

export type MatchStatus = "matched" | "ambiguous" | "unmatched";

export interface RegionMatch {
  provinsi: string;
  kabkota: string;
  status: MatchStatus;
  method?: "name" | "name+province" | "manual_qid";
  qid?: string;
  wikidataLabel?: string;
  lat?: number;
  lon?: number;
  kemendagriCode?: string | null;
  bpsCode?: string | null;
  /** Matched by name but Wikidata province differs from EQuran (expected for 2022 Papua splits). */
  provinceMismatch?: boolean;
  reason?: string;
  candidates?: string[];
}

export function matchRegions(
  equran: Readonly<Record<string, readonly string[]>>,
  wikidata: readonly WikidataRegion[],
  manualQidData: readonly WikidataRegion[] = [],
): RegionMatch[] {
  const index = new Map<string, WikidataRegion[]>();
  for (const w of wikidata) {
    const k = `${w.kind}|${compactKey(normalizeName(w.label))}`;
    const list = index.get(k) ?? [];
    list.push(w);
    index.set(k, list);
  }
  const manualByQid = new Map(manualQidData.map((w) => [w.qid, w]));
  const out: RegionMatch[] = [];

  for (const [provinsi, names] of Object.entries(equran)) {
    for (const kabkota of names) {
      const base = { provinsi, kabkota };
      const override = MANUAL_QID_OVERRIDES[`${provinsi}::${kabkota}`];
      if (override) {
        const w = manualByQid.get(override.qid);
        out.push(
          w
            ? { ...base, status: "matched", method: "manual_qid", ...pick(w), reason: override.reason }
            : { ...base, status: "unmatched", reason: `manual override ${override.qid} not present in data` },
        );
        continue;
      }
      const parsed = parseEquranName(kabkota);
      if (!parsed) {
        out.push({ ...base, status: "unmatched", reason: "name is not a regency/city name (sub-area label)" });
        continue;
      }
      const candidates = index.get(`${parsed.kind}|${compactKey(parsed.key)}`) ?? [];
      if (candidates.length === 0) {
        out.push({ ...base, status: "unmatched", reason: "no Wikidata item with this name and class and a coordinate" });
        continue;
      }
      const provKey = normalizeProvince(provinsi);
      const sameProv = candidates.filter((c) => c.provinces.some((p) => normalizeProvince(p) === provKey));
      if (candidates.length === 1) {
        const w = candidates[0]!;
        out.push({
          ...base,
          status: "matched",
          method: "name",
          ...pick(w),
          provinceMismatch: sameProv.length === 0 && w.provinces.length > 0,
        });
      } else if (sameProv.length === 1) {
        out.push({ ...base, status: "matched", method: "name+province", ...pick(sameProv[0]!) });
      } else {
        out.push({
          ...base,
          status: "ambiguous",
          reason: `${candidates.length} candidates, province did not single one out`,
          candidates: candidates.map((c) => c.qid),
        });
      }
    }
  }
  return out;
}

function pick(w: WikidataRegion) {
  return {
    qid: w.qid,
    wikidataLabel: w.label,
    lat: w.lat,
    lon: w.lon,
    kemendagriCode: w.kemendagriCode,
    bpsCode: w.bpsCode,
  };
}

export function buildCrosscheck(matches: readonly RegionMatch[], fetchedAt: string) {
  return {
    _note:
      "Koordinat dari Wikidata (CC0), dicocokkan ke nama EQuran oleh scripts/import-coordinates.ts. Dipakai hanya untuk cek silang astronomis (toleransi 6 menit). Wilayah di 'unmatched' tidak diisi tebakan dan tetap verification 'unchecked'. Wikidata bisa memberi titik ibu kota atau pusat wilayah, jadi akurasinya ratusan meter sampai beberapa kilometer, cukup untuk cek 6 menit.",
    provisional: false,
    source: "https://www.wikidata.org",
    license: "CC0 1.0",
    fetched_at: fetchedAt,
    regions: matches
      .filter((m) => m.status === "matched")
      .map((m) => ({
        provinsi: m.provinsi,
        kabkota: m.kabkota,
        lat: m.lat as number,
        lon: m.lon as number,
        wikidata_id: m.qid as string,
        match: m.method as string,
        ...(m.provinceMismatch ? { province_mismatch: true } : {}),
      })),
    unmatched: matches
      .filter((m) => m.status !== "matched")
      .map((m) => ({
        provinsi: m.provinsi,
        kabkota: m.kabkota,
        status: m.status,
        reason: m.reason ?? "",
        ...(m.candidates ? { candidates: m.candidates } : {}),
      })),
  };
}
