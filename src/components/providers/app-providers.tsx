"use client";

import { DevPanel } from "@/components/dev-panel/dev-panel";
import { AuthProvider } from "./auth-provider";
import { DataProvider } from "./data-provider";

/** Auth session, then the signed-in user's data layer and offline queue. One mount for the whole app. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DataProvider>
        {children}
        <DevPanel />
      </DataProvider>
    </AuthProvider>
  );
}
