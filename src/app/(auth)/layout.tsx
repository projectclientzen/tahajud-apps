import { AuthDevPanel } from "@/components/auth/auth-dev-panel";
import { AuthShell } from "@/components/auth/auth-shell";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AuthShell>{children}</AuthShell>
      <AuthDevPanel />
    </>
  );
}
