import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/ui/feedback-state";

export const metadata: Metadata = { title: "Al-Qur'an" };

export default function Page() {
  return (
    <>
      <PageHeader title="Al-Qur'an" />
      <EmptyState title="Halaman ini belum dibangun" description="Reader masuk sesi S4. Teks ayat menunggu import dataset Tanzil yang terverifikasi." />
    </>
  );
}
