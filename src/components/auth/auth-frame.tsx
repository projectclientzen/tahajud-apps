import Link from "next/link";
import * as React from "react";
import { DemoBadge } from "@/components/brand/demo-badge";
import { Wordmark } from "@/components/brand/wordmark";
import { cn } from "@/lib/cn";

/** Frame for screens outside the app shell: login, verify, access status, onboarding. */
export function AuthFrame({
  children,
  className,
  size = "md",
}: {
  children: React.ReactNode;
  className?: string;
  size?: "md" | "lg";
}) {
  return (
    <main
      id="main"
      className={cn(
        "mx-auto flex min-h-dvh w-full flex-col px-4 pb-10 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6",
        size === "lg" ? "max-w-xl" : "max-w-md",
      )}
    >
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="rounded-[var(--radius-control)] py-1">
          <Wordmark />
        </Link>
        <DemoBadge />
      </header>
      <div className={cn("flex flex-1 flex-col justify-center gap-6 py-10", className)}>{children}</div>
    </main>
  );
}

export const fieldClass =
  "min-h-12 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-body text-text placeholder:text-text-muted";
