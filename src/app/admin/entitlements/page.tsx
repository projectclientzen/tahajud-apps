import type { Metadata } from "next";

import { EntitlementsView } from "@/components/admin/support-views";

export const metadata: Metadata = { title: "Akses" };

export default function Page() {
  return <EntitlementsView />;
}
