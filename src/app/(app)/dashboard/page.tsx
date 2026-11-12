import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/ui/feedback-state";

export const metadata: Metadata = { title: "Beranda" };

export default function Page() {
  return (
    <>
      <PageHeader title="Dashboard Istiqomah" />
      <EmptyState title="Halaman ini belum dibangun" description="Dashboard Istiqomah masuk sesi S3, setelah engine tracking selesai di S2." />
    </>
  );
}
