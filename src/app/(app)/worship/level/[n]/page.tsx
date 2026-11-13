import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LevelHistory } from "@/components/worship/level-history";

export const metadata: Metadata = { title: "Riwayat level" };

/** Only levels 1 to 3 exist. Whether the user has reached one is decided from their own progress on the client. */
export const dynamicParams = false;
export const generateStaticParams = () => ["1", "2", "3"].map((n) => ({ n }));

export default async function Page({ params }: { params: Promise<{ n: string }> }) {
  const { n } = await params;
  if (n !== "1" && n !== "2" && n !== "3") notFound();
  return <LevelHistory level={Number(n) as 1 | 2 | 3} />;
}
