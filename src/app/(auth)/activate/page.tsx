import type { Metadata } from "next";
import { ActivateForm } from "@/components/auth/activate-form";

export const metadata: Metadata = { title: "Aktivasi akun" };

export default function Page() {
  return <ActivateForm />;
}
