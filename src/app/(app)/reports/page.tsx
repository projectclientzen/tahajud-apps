import type { Metadata } from "next";
import { ReportScreen } from "@/components/reports/report-view";

export const metadata: Metadata = { title: "Laporan" };

export default function Page() {
  return <ReportScreen />;
}
