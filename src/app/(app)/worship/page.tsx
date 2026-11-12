import type { Metadata } from "next";
import { WorshipHome } from "@/components/worship/worship-home";

export const metadata: Metadata = { title: "Amalan" };

export default function Page() {
  return <WorshipHome />;
}
