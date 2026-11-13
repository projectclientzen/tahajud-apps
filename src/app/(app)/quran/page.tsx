import type { Metadata } from "next";
import { QuranHome } from "@/components/quran/khatam-view";

export const metadata: Metadata = { title: "Al-Qur'an" };

export default function Page() {
  return <QuranHome />;
}
