/**
 * Qur'an catalog for GET /quran/surahs. Text comes from content/quran/uthmani.json (Tanzil Uthmani) and is passed
 * through verbatim: buildSurahText only splits off the opening basmalah when it matches the source byte for byte.
 * Nothing here types, trims or normalises Arabic. A surah the dataset does not hold is "not found", never filled in.
 */
import dataset from "@content/quran/uthmani.json";
import type { QuranSurahDetail, QuranSurahList } from "@/data/contracts";
import { buildSurahText, QURAN_ATTRIBUTION, type QuranDataset } from "@/data/quran/text";

/** Names only (Latin). Same six readings as PRD v1.2 §13.1. */
const NAMES: Readonly<Record<number, string>> = {
  18: "Al-Kahfi",
  36: "Yasin",
  55: "Ar-Rahman",
  56: "Al-Waqi'ah",
  65: "At-Talaq",
  67: "Al-Mulk",
};

const DATASET = dataset as unknown as QuranDataset;

const source = (ds: QuranDataset) => ({
  name: ds.source,
  sha256: ds.sha256,
  attribution: QURAN_ATTRIBUTION.text,
  source_url: QURAN_ATTRIBUTION.sourceUrl,
  license_name: QURAN_ATTRIBUTION.licenseName,
  license_url: QURAN_ATTRIBUTION.licenseUrl,
});

function meta(ds: QuranDataset, n: number) {
  const ayahs = ds.verses.filter((v) => v.surah === n).map((v) => v.ayah);
  if (ayahs.length === 0) return null;
  return {
    number: n,
    name: NAMES[n] ?? `Surah ${n}`,
    first_ayah: Math.min(...ayahs),
    last_ayah: Math.max(...ayahs),
    ayah_count: ayahs.length,
  };
}

export function listSurahs(ds: QuranDataset = DATASET): QuranSurahList {
  const numbers = [...new Set(ds.verses.map((v) => v.surah))].sort((a, b) => a - b);
  return {
    source: source(ds),
    surahs: numbers.map((n) => meta(ds, n)!),
  };
}

export function getSurah(n: number, ds: QuranDataset = DATASET): QuranSurahDetail | null {
  const m = meta(ds, n);
  const text = m ? buildSurahText(ds, n) : null;
  if (!m || !text) return null;
  return { surah: m, opening: text.opening, verses: text.verses, source: source(ds) };
}
