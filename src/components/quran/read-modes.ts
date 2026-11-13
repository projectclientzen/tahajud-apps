import { JUZ_COUNT, PAGE_COUNT } from "@/domain/quran";

export type ReadMode = "surah" | "juz" | "halaman";

export function modeLimit(mode: ReadMode): number {
  return mode === "surah" ? 114 : mode === "juz" ? JUZ_COUNT : PAGE_COUNT;
}

export function isReadMode(x: string): x is ReadMode {
  return x === "surah" || x === "juz" || x === "halaman";
}

export const readHref = (mode: ReadMode, n: number) => `/quran/baca/${mode}/${n}`;
