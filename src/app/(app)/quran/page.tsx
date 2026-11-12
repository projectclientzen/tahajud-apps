import type { Metadata } from "next";
import { SurahList } from "@/components/quran/surah-list";

export const metadata: Metadata = { title: "Al-Qur'an" };

export default function Page() {
  return <SurahList />;
}
