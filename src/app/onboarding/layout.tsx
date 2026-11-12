import { AuthDevPanel } from "@/components/auth/auth-dev-panel";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignedInProviders } from "@/components/auth/signed-in-providers";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <SignedInProviders gate="onboarding">
      <AuthShell>{children}</AuthShell>
      <AuthDevPanel />
    </SignedInProviders>
  );
}
