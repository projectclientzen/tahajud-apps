import { DevPanel } from "@/components/dev-panel/dev-panel";
import { DataProvider } from "@/components/providers/data-provider";
import { AppShell } from "@/components/shell/app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DataProvider>
      <AppShell>{children}</AppShell>
      <DevPanel />
    </DataProvider>
  );
}
