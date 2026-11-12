import type { Metadata } from "next";
import { CalendarScreen } from "@/components/reports/calendar-view";

export const metadata: Metadata = { title: "Riwayat istiqomah" };

export default function Page() {
  return <CalendarScreen />;
}
