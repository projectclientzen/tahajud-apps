/**
 * Full Qur'an text (114 surahs). Each surah is its own static file, public/quran/surah-NNN.json, written by
 * scripts/import-quran.ts straight from the Tanzil source (checksum in content/quran/SOURCE.md). The service worker
 * keeps static files only; nothing here goes through /api/. A surah that cannot be loaded is `null`: never invented.
 */
import {
  createMushaf,
  type AyahRange,
  type Mushaf,
  type QuranMeta,
} from "@/domain/quran";
import metaFile from "@content/quran/meta.json";
import { buildSurahText, type QuranDataset, type SurahText } from "./text";

export const quranMeta = metaFile as unknown as QuranMeta;
export const mushaf: Mushaf = createMushaf(quranMeta);

export const surahFileUrl = (n: number): string => `/quran/surah-${String(n).padStart(3, "0")}.json`;

interface SurahFile {
  surah: number;
  sha256: string;
  verses: { ayah: number; text: string }[];
}

/** One run of ayahs for display. `opening` (basmalah line) is set only on the run that begins at ayah 1. */
export interface PageSegment {
  surah: number;
  surahName: string;
  /** Show the surah heading: true when the run starts at ayah 1. */
  starts: boolean;
  opening: string | null;
  verses: { number: number; text: string }[];
}

export interface FullQuranText {
  /** Whole surah in the same shape the six-readings reader uses. Null if the file is missing or damaged. */
  getSurah(n: number): Promise<SurahText | null>;
  /** Ayahs of the given runs, in order. Null if any surah could not be loaded. */
  getSegments(ranges: readonly AyahRange[]): Promise<PageSegment[] | null>;
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

function isSurahFile(x: unknown, n: number, expected: number): x is SurahFile {
  const f = x as SurahFile;
  return (
    !!f &&
    f.surah === n &&
    Array.isArray(f.verses) &&
    f.verses.length === expected &&
    f.verses.every((v, i) => v.ayah === i + 1 && typeof v.text === "string" && v.text.length > 0)
  );
}

export function createFullQuranText(
  fetchJson: FetchLike = (url) => fetch(url, { cache: "force-cache" }),
): FullQuranText {
  const cache = new Map<number, Promise<SurahText | null>>();

  async function load(n: number): Promise<SurahText | null> {
    const info = mushaf.surah(n);
    if (!info) return null;
    try {
      const res = await fetchJson(surahFileUrl(n));
      if (!res.ok) return null;
      const file = await res.json();
      if (!isSurahFile(file, n, info.ayahs)) return null;
      const ds: QuranDataset = {
        source: "tanzil-uthmani",
        sha256: file.sha256,
        verses: file.verses.map((v) => ({ surah: n, ayah: v.ayah, text: v.text })),
      };
      return buildSurahText(ds, n);
    } catch {
      return null;
    }
  }

  function getSurah(n: number): Promise<SurahText | null> {
    let p = cache.get(n);
    if (!p) {
      p = load(n);
      cache.set(n, p);
    }
    // A failed load is not kept, so a retry after coming back online works.
    return p.then((t) => {
      if (t === null) cache.delete(n);
      return t;
    });
  }

  return {
    getSurah,
    async getSegments(ranges) {
      const out: PageSegment[] = [];
      for (const r of ranges) {
        const t = await getSurah(r.surah);
        if (!t) return null;
        out.push({
          surah: r.surah,
          surahName: mushaf.surah(r.surah)?.name ?? `Surah ${r.surah}`,
          starts: r.from === 1,
          opening: r.from === 1 ? t.opening : null,
          verses: t.verses.filter((v) => v.number >= r.from && v.number <= r.to),
        });
      }
      return out;
    },
  };
}

/** Shared instance: surahs are fetched one at a time and remembered for the page session. */
export const fullQuran: FullQuranText = createFullQuranText();
