import type { Metadata } from "next";
import { UserDetailView } from "@/components/admin/support-views";

export const metadata: Metadata = { title: "Akun" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserDetailView id={id} />;
}
