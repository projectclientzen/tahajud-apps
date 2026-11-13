import type { Metadata } from "next";

import { QuranContentView } from "@/components/admin/content-views";

export const metadata: Metadata = { title: "Konten Qur'an" };

export default function Page() {
  return <QuranContentView />;
}
