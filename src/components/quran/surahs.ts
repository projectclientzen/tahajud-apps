/** The six readings of PRD v1.2 §13.1. Names and counts only: no Qur'an text lives in this file. */
export interface SurahMeta {
  number: number;
  name: string;
  /** First and last ayah of the reading. At-Talaq is ayah 2-3 only. */
  first: number;
  last: number;
}

export const SURAHS: readonly SurahMeta[] = [
  { number: 36, name: "Yasin", first: 1, last: 83 },
  { number: 56, name: "Al-Waqi'ah", first: 1, last: 96 },
  { number: 67, name: "Al-Mulk", first: 1, last: 30 },
  { number: 55, name: "Ar-Rahman", first: 1, last: 78 },
  { number: 18, name: "Al-Kahfi", first: 1, last: 110 },
  { number: 65, name: "At-Talaq", first: 2, last: 3 },
];

export const AL_KAHFI = 18;

export const surahByNumber = (n: number): SurahMeta | undefined => SURAHS.find((s) => s.number === n);

export const ayahCount = (s: SurahMeta): number => s.last - s.first + 1;

/** Ayah position inside the reading, 0 when nothing was read yet. */
export const readCount = (s: SurahMeta, ayah: number | null): number =>
  ayah === null ? 0 : Math.min(Math.max(ayah - s.first + 1, 0), ayahCount(s));
