import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchView } from "@/components/admin/support-views";

export const metadata: Metadata = { title: "Cari pembeli" };

export default function Page() {
  return <Suspense><SearchView /></Suspense>;
}
