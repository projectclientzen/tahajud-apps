import type { Metadata } from "next";
import { AdminGate } from "@/components/admin/admin-gate";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | Admin Tahajud Tracker" },
  robots: { index: false, follow: false },
};
// No prerendered copy: the page shell is served fresh and nothing about it is cached.
export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
