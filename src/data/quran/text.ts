/**
 * Qur'an text repository. The only door for ayah text in the app.
 *
 * Text comes from content/quran/uthmani.json (Tanzil Uthmani, checksum in SOURCE.md) and is never typed,
 * trimmed or normalised here. The one transformation is the opening line: Tanzil puts the basmalah in front of
 * ayah 1 of most surahs. It is split off into its own line only when the prefix equals the text of source 1:1
 * plus one space, byte for byte. Otherwise ayah 1 is shown whole. Joining opening + " " + ayah 1 always gives
 * the source text back, and tests/unit/data/quran-text.test.ts checks that against the source file.
 */
import basmalahData from "@content/quran/basmalah.json";

export interface DatasetVerse {
  surah: number;
  ayah: number;
  text: string;
}

export interface QuranDataset {
  source: string;
  sha256: string;
  verses: DatasetVerse[];
}

export interface SurahVerse {
  number: number;
  text: string;
}

export interface QuranAttribution {
  /** Short line shown at the end of the surah. */
  text: string;
  sourceName: string;
  sourceUrl: string;
  licenseName: string;
  licenseUrl: string;
}

export interface SurahText {
  surah: number;
  /** Basmalah as its own opening line, or null when ayah 1 carries no such prefix (and for At-Talaq 2-3). */
  opening: string | null;
  verses: SurahVerse[];
  attribution: QuranAttribution;
}

/** From content/quran/SOURCE.md. Keep in sync with that file. */
export const QURAN_ATTRIBUTION: QuranAttribution = {
  text: "Teks Al-Qur'an: Tanzil Project (tanzil.net), lisensi Creative Commons Attribution 3.0.",
  sourceName: "tanzil.net",
  sourceUrl: "https://tanzil.net",
  licenseName: "Creative Commons Attribution 3.0",
  licenseUrl: "https://tanzil.net/docs/Text_License",
};

export const BASMALAH: string = basmalahData.text;

/** Pure: builds one surah from a dataset. Returns null when the dataset has no verses for it. */
export function buildSurahText(dataset: QuranDataset, surah: number, basmalah: string = BASMALAH): SurahText | null {
  const verses = dataset.verses.filter((v) => v.surah === surah).sort((a, b) => a.ayah - b.ayah);
  const first = verses[0];
  if (!first) return null;
  const prefix = `${basmalah} `;
  // Only a surah that starts at ayah 1 can carry the basmalah prefix (At-Talaq here starts at ayah 2).
  const splits = first.ayah === 1 && first.text.startsWith(prefix);
  return {
    surah,
    opening: splits ? basmalah : null,
    verses: verses.map((v, i) => ({
      number: v.ayah,
      text: i === 0 && splits ? v.text.slice(prefix.length) : v.text,
    })),
    attribution: QURAN_ATTRIBUTION,
  };
}

export interface QuranTextRepository {
  /** Null when the dataset is missing or has no verses for the surah. Never returns invented text. */
  getSurah(surah: number): Promise<SurahText | null>;
}

/** Loads the dataset in its own chunk, so list and dashboard screens do not pay for 86 KB of text. */
export function createDatasetQuranText(
  load: () => Promise<QuranDataset> = async () =>
    (await import("@content/quran/uthmani.json")).default as unknown as QuranDataset,
): QuranTextRepository {
  let cache: Promise<QuranDataset> | null = null;
  return {
    async getSurah(surah) {
      cache ??= load();
      try {
        return buildSurahText(await cache, surah);
      } catch {
        cache = null;
        return null;
      }
    },
  };
}
