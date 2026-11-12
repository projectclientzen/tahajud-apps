import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Reader } from "@/components/quran/reader";
import { SURAHS, surahByNumber } from "@/components/quran/surahs";

export const metadata: Metadata = { title: "Bacaan Al-Qur'an" };

/**
 * Only the six readings exist. Telling Next the full list makes any other number a real 404 before rendering.
 * Calling notFound() alone is not enough here: the signed-in gate in the app layout does not render the page on
 * the server, so the page's 404 would arrive after the response status was already sent as 200.
 */
export const dynamicParams = false;
export const generateStaticParams = () => SURAHS.map((s) => ({ surah: String(s.number) }));

export default async function Page({ params }: { params: Promise<{ surah: string }> }) {
  const { surah } = await params;
  const meta = /^\d+$/.test(surah) ? surahByNumber(Number(surah)) : undefined;
  if (!meta) notFound();
  return <Reader surah={meta.number} />;
}
