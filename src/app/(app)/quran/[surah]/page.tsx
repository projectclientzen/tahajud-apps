import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Reader } from "@/components/quran/reader";
import { surahByNumber } from "@/components/quran/surahs";

export const metadata: Metadata = { title: "Bacaan Al-Qur'an" };

export default async function Page({ params }: { params: Promise<{ surah: string }> }) {
  const { surah } = await params;
  const meta = /^\d+$/.test(surah) ? surahByNumber(Number(surah)) : undefined;
  if (!meta) notFound();
  return <Reader surah={meta.number} />;
}
