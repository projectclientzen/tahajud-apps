import { SignedInProviders } from "@/components/auth/signed-in-providers";
import { DevPanel } from "@/components/dev-panel/dev-panel";
import { AppShell } from "@/components/shell/app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SignedInProviders gate="app">
      <AppShell>{children}</AppShell>
      <DevPanel />
    </SignedInProviders>
  );
}
