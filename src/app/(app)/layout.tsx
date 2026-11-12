import { AppGate } from "@/components/auth/gate";
import { AppShell } from "@/components/shell/app-shell";

/** Everything inside the app needs a signed-in user with active access who finished onboarding. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppGate need="app">
      <AppShell>{children}</AppShell>
    </AppGate>
  );
}
