import type { Metadata } from "next";

import { TemplatesView } from "@/components/admin/content-views";

export const metadata: Metadata = { title: "Notifikasi" };

export default function Page() {
  return <TemplatesView />;
}
