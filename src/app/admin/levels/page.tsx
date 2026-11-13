import type { Metadata } from "next";

import { LevelsView } from "@/components/admin/content-views";

export const metadata: Metadata = { title: "Level" };

export default function Page() {
  return <LevelsView />;
}
