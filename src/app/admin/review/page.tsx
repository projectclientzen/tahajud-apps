import type { Metadata } from "next";

import { ReviewView } from "@/components/admin/content-views";

export const metadata: Metadata = { title: "Review konten" };

export default function Page() {
  return <ReviewView />;
}
