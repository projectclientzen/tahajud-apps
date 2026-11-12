import type { Metadata } from "next";
import { AccessStatusView } from "@/components/auth/access-status-view";

export const metadata: Metadata = { title: "Status akses" };

export default function Page() {
  return <AccessStatusView />;
}
