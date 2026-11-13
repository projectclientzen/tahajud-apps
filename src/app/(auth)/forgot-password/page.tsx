import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Lupa password" };

export default function Page() {
  return <ForgotPasswordForm />;
}
