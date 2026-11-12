import type { Metadata } from "next";
import { VerifyForm } from "@/components/auth/verify-form";

export const metadata: Metadata = { title: "Masukkan kode" };

export default function Page() {
  return <VerifyForm />;
}
