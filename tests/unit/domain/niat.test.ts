import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAmalan, getNiat, niatFor, niatView, parseNiat } from "@/domain/content";

const file = JSON.parse(readFileSync("content/niat.v1.json", "utf8")) as { niat: { activity_key: string }[] };
const base = {
  content_version: "1.0.0",
  review_status: "published",
  approved_by: "owner",
  niat: [{ activity_key: "salat_tahajud", title: "Salat Tahajud", arabic: "A", latin: "L", translation: null }],
};

describe("NIAT konten niat salat", () => {
  it("memuat enam langkah salat dan setiap kuncinya ada di konten amalan", () => {
    const keys = getNiat().entries.map((e) => e.activityKey);
    expect(keys).toEqual(file.niat.map((e) => e.activity_key));
    expect(keys).toHaveLength(6);
    const amalanKeys = new Set(
      [1, 2, 3].flatMap((lv) => getAmalan().levels[lv as 1 | 2 | 3].activities.map((a) => a.key)),
    );
    for (const k of keys) expect(amalanKeys.has(k), k).toBe(true);
  });

  it("selama owner belum mengisi: semua langkah tidak tersedia dan tidak ada teks buatan", () => {
    for (const e of getNiat().entries) {
      expect(e.arabic).toBeNull();
      const v = niatView(getNiat(), e);
      expect(v).toMatchObject({ state: "unavailable", arabic: null, latin: null, translation: null, needsReview: false });
    }
  });

  it("teks terisi dan published: tersedia tanpa badge; terjemahan opsional", () => {
    const c = parseNiat(base);
    const v = niatView(c, niatFor(c, "salat_tahajud")!);
    expect(v).toEqual({ state: "available", title: "Salat Tahajud", arabic: "A", latin: "L", translation: null, needsReview: false });
    const t = parseNiat({ ...base, niat: [{ ...base.niat[0]!, translation: "T" }] });
    expect(niatView(t, t.entries[0]!).translation).toBe("T");
  });

  it("teks terisi tetapi belum published: tersedia dengan penanda tinjauan", () => {
    const c = parseNiat({ ...base, review_status: "draft" });
    expect(niatView(c, c.entries[0]!)).toMatchObject({ state: "available", needsReview: true });
  });

  it("hanya Arab atau hanya Latin terisi: tampil yang terisi saja; keduanya kosong atau spasi = belum tersedia", () => {
    const only = (patch: object) => {
      const c = parseNiat({ ...base, niat: [{ ...base.niat[0]!, ...patch }] });
      return niatView(c, c.entries[0]!);
    };
    expect(only({ latin: null })).toMatchObject({ state: "available", arabic: "A", latin: null });
    expect(only({ arabic: null })).toMatchObject({ state: "available", arabic: null, latin: "L" });
    expect(only({ arabic: "  ", latin: "" }).state).toBe("unavailable");
    // A translation alone is not a niat text to show.
    expect(only({ arabic: null, latin: null, translation: "T" })).toMatchObject({ state: "unavailable", translation: null });
  });

  it("teks dilewatkan apa adanya (tanpa trim atau ubah harakat)", () => {
    const raw = "  بِسْمِ  ";
    const c = parseNiat({ ...base, niat: [{ ...base.niat[0]!, arabic: raw, latin: " x " }] });
    const v = niatView(c, c.entries[0]!);
    expect(v.arabic).toBe(raw);
    expect(v.latin).toBe(" x ");
  });

  it("langkah tanpa entri niat = null; berkas rusak ditolak", () => {
    expect(niatFor(getNiat(), "salat_subuh")).toBeNull();
    expect(() => parseNiat({ niat: [] })).toThrow();
  });
});
