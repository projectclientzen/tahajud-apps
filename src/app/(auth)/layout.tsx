import { AuthFrame } from "@/components/auth/auth-frame";
import { GuestOnly } from "@/components/auth/gate";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthFrame>
      <GuestOnly>{children}</GuestOnly>
    </AuthFrame>
  );
}
