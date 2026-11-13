import type { Metadata } from "next";
import { Suspense } from "react";
import { OrdersView } from "@/components/admin/support-views";

export const metadata: Metadata = { title: "Pembelian" };

export default function Page() {
  return <Suspense><OrdersView /></Suspense>;
}
