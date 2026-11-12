import type { Metadata } from "next";
import { LevelsView } from "@/components/levels/levels-view";

export const metadata: Metadata = { title: "Perjalanan level" };

export default function Page() {
  return <LevelsView />;
}
