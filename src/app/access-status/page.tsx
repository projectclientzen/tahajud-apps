import type { Metadata } from "next";
import { AccessStatusView } from "@/components/auth/access-status-view";
import { AuthFrame } from "@/components/auth/auth-frame";

export const metadata: Metadata = { title: "Status akses" };

export default function AccessStatusPage() {
  return (
    <AuthFrame>
      <AccessStatusView />
    </AuthFrame>
  );
}
