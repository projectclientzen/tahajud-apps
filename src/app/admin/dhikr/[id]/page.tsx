import type { Metadata } from "next";
import { ActivityDetailView } from "@/components/admin/content-views";

export const metadata: Metadata = { title: "Dzikir" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ActivityDetailView id={id} group="dhikr" />;
}
