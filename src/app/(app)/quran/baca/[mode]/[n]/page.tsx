import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KhatamReaderPage } from "@/components/quran/reader-page";
import { isReadMode, modeLimit } from "@/components/quran/read-modes";

export const metadata: Metadata = { title: "Bacaan Al-Qur'an" };

/** Every surah, juz and page is pre-listed so any other number is a real 404 (same reason as /quran/[surah]). */
export const dynamicParams = false;
export const generateStaticParams = () =>
  (["surah", "juz", "halaman"] as const).flatMap((mode) =>
    Array.from({ length: modeLimit(mode) }, (_, i) => ({ mode, n: String(i + 1) })),
  );

export default async function Page({ params }: { params: Promise<{ mode: string; n: string }> }) {
  const { mode, n } = await params;
  if (!isReadMode(mode) || !/^\d+$/.test(n) || Number(n) < 1 || Number(n) > modeLimit(mode)) notFound();
  return <KhatamReaderPage mode={mode} n={Number(n)} />;
}
