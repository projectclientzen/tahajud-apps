import type { Metadata } from "next";
import { ResetForm } from "@/components/auth/reset-form";

export const metadata: Metadata = { title: "Buat password baru" };

export default function Page() {
  return <ResetForm />;
}
