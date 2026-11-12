"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { SCALEV_URL } from "./auth-shell";

/** Buttons on the entry page. A signed-in visitor goes straight to the dashboard (PRD §5.2). */
export function EntryActions() {
  const { status } = useAuth();
  const router = useRouter();
  React.useEffect(() => {
    if (status === "signedIn") router.replace("/dashboard");
  }, [status, router]);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}>
        Masuk
      </Link>
      {SCALEV_URL ? (
        <a href={SCALEV_URL} className={cn(buttonVariants({ size: "lg", variant: "secondary" }), "w-full sm:w-auto")}>
          Beli akses di Scalev
        </a>
      ) : null}
    </div>
  );
}
