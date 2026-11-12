import { AuthDevPanel } from "@/components/auth/auth-dev-panel";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignedInProviders } from "@/components/auth/signed-in-providers";

export default function AccessStatusLayout({ children }: { children: React.ReactNode }) {
  return (
    <SignedInProviders gate="access">
      <AuthShell>{children}</AuthShell>
      <AuthDevPanel />
    </SignedInProviders>
  );
}
