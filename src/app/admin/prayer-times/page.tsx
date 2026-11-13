import type { Metadata } from "next";

import { PrayerView } from "@/components/admin/ops-views";

export const metadata: Metadata = { title: "Jadwal salat" };

export default function Page() {
  return <PrayerView />;
}
