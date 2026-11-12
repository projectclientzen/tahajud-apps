import { DEV_ROUTES_ENABLED } from "@/lib/env";

export interface SurahText {
  verses: { number: number; text: string }[];
  attribution: string;
  /** True for test text injected in dev builds. The reader must say so on screen. */
  isFixture: boolean;
}

declare global {
  interface Window {
    /** Dev and e2e only. Test text that is clearly not Qur'an, keyed by surah number. */
    __TT_QURAN_FIXTURE__?: Record<number, { number: number; text: string }[]>;
  }
}

/**
 * The only door for ayah text. Until the verified Tanzil dataset is imported (T4) it returns null,
 * and the reader shows an honest empty state. Never generate ayah text here (CLAUDE.md).
 */
export async function loadSurahText(surah: number): Promise<SurahText | null> {
  if (DEV_ROUTES_ENABLED && typeof window !== "undefined") {
    const verses = window.__TT_QURAN_FIXTURE__?.[surah];
    if (verses?.length)
      return { verses, attribution: "Teks uji untuk pengembangan. Ini bukan Al-Qur'an.", isFixture: true };
  }
  return null;
}
