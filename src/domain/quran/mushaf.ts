/**
 * Pure helpers over Tanzil's quran-data metadata (surah table, 30 juz starts, 604 page starts).
 * No Qur'an text lives here, only positions. Page = Madinah mushaf page; the reader groups ayahs by page and
 * does not try to look like a printed mushaf.
 */
export type AyahRef = readonly [surah: number, ayah: number];

export interface SurahInfo {
  number: number;
  name: string;
  english: string;
  type: "Meccan" | "Medinan";
  ayahs: number;
}

export interface QuranMeta {
  surahs: readonly SurahInfo[];
  /** Index 0 = juz 1. */
  juz: readonly AyahRef[];
  /** Index 0 = page 1. */
  pages: readonly AyahRef[];
}

/** A run of consecutive ayahs inside one surah. */
export interface AyahRange {
  surah: number;
  from: number;
  to: number;
}

export const PAGE_COUNT = 604;
export const JUZ_COUNT = 30;
export const AYAH_COUNT = 6236;

export interface Mushaf {
  readonly meta: QuranMeta;
  surah(n: number): SurahInfo | undefined;
  /** 1-based position of an ayah in the whole Qur'an (1:1 = 1, 114:6 = 6236). Null for an invalid reference. */
  ordinal(surah: number, ayah: number): number | null;
  /** Inverse of ordinal. */
  fromOrdinal(ordinal: number): AyahRef | null;
  pageOf(surah: number, ayah: number): number | null;
  juzOf(surah: number, ayah: number): number | null;
  /** Ayah runs on one page, in reading order (a page can hold the end of one surah and the start of the next). */
  pageRanges(page: number): AyahRange[];
  juzRanges(juz: number): AyahRange[];
  surahRange(surah: number): AyahRange | null;
  /** First ayah of a page, or null when the page does not exist. */
  pageStart(page: number): AyahRef | null;
  /** Last ayah of a page. */
  pageEnd(page: number): AyahRef | null;
  /** First page of a surah / juz. */
  surahFirstPage(surah: number): number | null;
  juzFirstPage(juz: number): number | null;
}

function isInt(n: number): boolean {
  return Number.isInteger(n);
}

export function createMushaf(meta: QuranMeta): Mushaf {
  // offsets[s] = number of ayahs before surah s (surah 1 -> 0).
  const offsets: number[] = [0, 0];
  for (let s = 1; s <= meta.surahs.length; s++) offsets[s + 1] = (offsets[s] ?? 0) + (meta.surahs[s - 1]?.ayahs ?? 0);
  const total = offsets[meta.surahs.length + 1] ?? 0;

  const surah = (n: number) => (isInt(n) ? meta.surahs[n - 1] : undefined);

  const ordinal = (s: number, a: number): number | null => {
    const info = surah(s);
    if (!info || !isInt(a) || a < 1 || a > info.ayahs) return null;
    return (offsets[s] ?? 0) + a;
  };

  const fromOrdinal = (o: number): AyahRef | null => {
    if (!isInt(o) || o < 1 || o > total) return null;
    let lo = 1;
    let hi = meta.surahs.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((offsets[mid] ?? 0) < o) lo = mid;
      else hi = mid - 1;
    }
    return [lo, o - (offsets[lo] ?? 0)];
  };

  const startsOrdinals = (list: readonly AyahRef[]): number[] => list.map(([s, a]) => ordinal(s, a) ?? 0);
  const pageStarts = startsOrdinals(meta.pages);
  const juzStarts = startsOrdinals(meta.juz);

  const indexIn = (starts: number[], o: number): number => {
    // Largest index whose start <= o.
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] ?? 0) <= o) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const rangesBetween = (fromOrd: number, toOrd: number): AyahRange[] => {
    const out: AyahRange[] = [];
    let cur = fromOrd;
    while (cur <= toOrd) {
      const ref = fromOrdinal(cur);
      if (!ref) break;
      const lastOfSurah = (offsets[ref[0]] ?? 0) + (surah(ref[0])?.ayahs ?? 0);
      const end = Math.min(lastOfSurah, toOrd);
      out.push({ surah: ref[0], from: ref[1], to: ref[1] + (end - cur) });
      cur = end + 1;
    }
    return out;
  };

  const pageEndOrd = (page: number): number => (page >= pageStarts.length ? total : (pageStarts[page] ?? total + 1) - 1);
  const juzEndOrd = (j: number): number => (j >= juzStarts.length ? total : (juzStarts[j] ?? total + 1) - 1);

  const validPage = (p: number) => isInt(p) && p >= 1 && p <= pageStarts.length;
  const validJuz = (j: number) => isInt(j) && j >= 1 && j <= juzStarts.length;

  return {
    meta,
    surah,
    ordinal,
    fromOrdinal,
    pageOf(s, a) {
      const o = ordinal(s, a);
      return o === null ? null : indexIn(pageStarts, o);
    },
    juzOf(s, a) {
      const o = ordinal(s, a);
      return o === null ? null : indexIn(juzStarts, o);
    },
    pageRanges: (p) => (validPage(p) ? rangesBetween(pageStarts[p - 1] ?? 0, pageEndOrd(p)) : []),
    juzRanges: (j) => (validJuz(j) ? rangesBetween(juzStarts[j - 1] ?? 0, juzEndOrd(j)) : []),
    surahRange(s) {
      const info = surah(s);
      return info ? { surah: s, from: 1, to: info.ayahs } : null;
    },
    pageStart: (p) => (validPage(p) ? (meta.pages[p - 1] ?? null) : null),
    pageEnd: (p) => (validPage(p) ? fromOrdinal(pageEndOrd(p)) : null),
    surahFirstPage(s) {
      return surah(s) ? this.pageOf(s, 1) : null;
    },
    juzFirstPage: (j) => (validJuz(j) ? (indexIn(pageStarts, juzStarts[j - 1] ?? 0)) : null),
  };
}
