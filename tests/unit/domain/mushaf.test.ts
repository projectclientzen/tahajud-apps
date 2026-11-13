import { describe, expect, it } from "vitest";
import { AYAH_COUNT, createMushaf, JUZ_COUNT, PAGE_COUNT, type QuranMeta } from "@/domain/quran";
import metaFile from "@content/quran/meta.json";

const meta = metaFile as unknown as QuranMeta;
const m = createMushaf(meta);

describe("QURAN-04 metadata halaman dan juz (Tanzil quran-data)", () => {
  it("114 surah, 6236 ayat, 30 juz, 604 halaman", () => {
    expect(meta.surahs).toHaveLength(114);
    expect(meta.surahs.reduce((n, s) => n + s.ayahs, 0)).toBe(AYAH_COUNT);
    expect(meta.juz).toHaveLength(JUZ_COUNT);
    expect(meta.pages).toHaveLength(PAGE_COUNT);
  });

  it("halaman 1 = 1:1 sampai 1:7, halaman 2 mulai 2:1", () => {
    expect(m.pageRanges(1)).toEqual([{ surah: 1, from: 1, to: 7 }]);
    expect(m.pageStart(2)).toEqual([2, 1]);
    expect(m.pageEnd(1)).toEqual([1, 7]);
  });

  it("halaman terakhir berakhir di 114:6 dan mulai di 112:1", () => {
    expect(m.pageStart(604)).toEqual([112, 1]);
    expect(m.pageEnd(604)).toEqual([114, 6]);
    expect(m.pageRanges(604)).toEqual([
      { surah: 112, from: 1, to: 4 },
      { surah: 113, from: 1, to: 5 },
      { surah: 114, from: 1, to: 6 },
    ]);
  });

  it("juz 1 = 1:1..1:7 + 2:1..2:141, juz 2 mulai 2:142, juz 30 mulai 78:1 dan berakhir 114:6", () => {
    expect(m.juzRanges(1)).toEqual([
      { surah: 1, from: 1, to: 7 },
      { surah: 2, from: 1, to: 141 },
    ]);
    expect(m.juzRanges(2)[0]).toEqual({ surah: 2, from: 142, to: 252 });
    expect(m.juzRanges(30)[0]).toMatchObject({ surah: 78, from: 1 });
    expect(m.juzRanges(30).at(-1)).toEqual({ surah: 114, from: 1, to: 6 });
  });

  it("setiap ayat ada tepat sekali di halaman, dan tepat sekali di juz", () => {
    for (const [label, count, ranges] of [
      ["halaman", PAGE_COUNT, (i: number) => m.pageRanges(i)],
      ["juz", JUZ_COUNT, (i: number) => m.juzRanges(i)],
    ] as const) {
      const seen = new Set<number>();
      for (let i = 1; i <= count; i++) {
        const rs = ranges(i);
        expect(rs.length, `${label} ${i}`).toBeGreaterThan(0);
        for (const r of rs)
          for (let a = r.from; a <= r.to; a++) {
            const o = m.ordinal(r.surah, a)!;
            expect(seen.has(o), `${label} ${i} duplikat ${r.surah}:${a}`).toBe(false);
            seen.add(o);
          }
      }
      expect(seen.size).toBe(AYAH_COUNT);
    }
  });

  it("pageOf dan juzOf konsisten dengan rentang, ordinal bolak-balik", () => {
    for (let p = 1; p <= PAGE_COUNT; p++) {
      for (const r of m.pageRanges(p)) {
        expect(m.pageOf(r.surah, r.from)).toBe(p);
        expect(m.pageOf(r.surah, r.to)).toBe(p);
      }
    }
    for (let o = 1; o <= AYAH_COUNT; o += 37) {
      const ref = m.fromOrdinal(o)!;
      expect(m.ordinal(ref[0], ref[1])).toBe(o);
    }
    expect(m.fromOrdinal(AYAH_COUNT)).toEqual([114, 6]);
    expect(m.juzOf(2, 142)).toBe(2);
    expect(m.juzOf(2, 141)).toBe(1);
    expect(m.surahFirstPage(2)).toBe(2);
    expect(m.juzFirstPage(30)).toBe(m.pageOf(78, 1));
  });

  it("referensi tidak valid mengembalikan null / kosong", () => {
    expect(m.pageOf(0, 1)).toBeNull();
    expect(m.pageOf(1, 8)).toBeNull();
    expect(m.pageOf(115, 1)).toBeNull();
    expect(m.ordinal(1, 1.5)).toBeNull();
    expect(m.pageRanges(0)).toEqual([]);
    expect(m.pageRanges(605)).toEqual([]);
    expect(m.juzRanges(31)).toEqual([]);
    expect(m.surahRange(115)).toBeNull();
    expect(m.surahRange(18)).toEqual({ surah: 18, from: 1, to: 110 });
    expect(m.fromOrdinal(0)).toBeNull();
    expect(m.pageStart(0)).toBeNull();
  });
});
