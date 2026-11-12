import { csLink } from "@/components/help/help-view";
import * as React from "react";
import { DemoBadge } from "@/components/brand/demo-badge";
import { Wordmark } from "@/components/brand/wordmark";

/** Narrow single-column frame for login, verify, onboarding and access screens (no app navigation). */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <Wordmark />
        <DemoBadge />
      </header>
      <main id="main" className="flex flex-1 flex-col gap-6 pb-12">
        {children}
      </main>
    </div>
  );
}

export const fieldClass =
  "min-h-12 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-body";

/** Optional links from env. Shown only when set, so no link ever points at a made-up address. */
export const SCALEV_URL = process.env.NEXT_PUBLIC_SCALEV_URL ?? "";
// Same env and normalisation as /help and /settings/account (digits only, built into a wa.me link).
export const CS_WHATSAPP_URL = csLink(process.env.NEXT_PUBLIC_CS_WHATSAPP) ?? "";
