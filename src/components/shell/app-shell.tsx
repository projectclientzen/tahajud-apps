import * as React from "react";
import { UpdatePrompt } from "@/components/pwa/update-prompt";
import { OfflineBanner } from "./offline-banner";
import { BottomNav, SidebarNav } from "./primary-nav";

/**
 * Mobile and tablet: single column + bottom nav.
 * Desktop (>=1024px): fixed sidebar + capped content column.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-[var(--radius-control)] bg-primary px-4 py-3 text-on-primary focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Lewati ke konten
      </a>
      <SidebarNav />
      <div className="flex min-h-dvh flex-col lg:pl-[var(--sidebar-width)]">
        <OfflineBanner />
        <main
          id="main"
          className="mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 pb-[calc(var(--nav-height)+env(safe-area-inset-bottom)+1.5rem)] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:px-10 lg:pb-12 lg:pt-8"
        >
          <div className="mb-4 empty:hidden">
            <UpdatePrompt />
          </div>
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
