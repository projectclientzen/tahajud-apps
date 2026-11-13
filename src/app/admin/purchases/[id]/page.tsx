import type { Metadata } from "next";
import { OrderDetailView } from "@/components/admin/support-views";

export const metadata: Metadata = { title: "Order" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetailView id={id} />;
}
