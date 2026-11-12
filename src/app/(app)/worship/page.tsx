import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/ui/feedback-state";

export const metadata: Metadata = { title: "Amalan" };

export default function Page() {
  return (
    <>
      <PageHeader title="Amalan malam ini" />
      <EmptyState title="Halaman ini belum dibangun" description="Daftar amalan, sesi ibadah, dan counter dzikir masuk sesi S3." />
    </>
  );
}
