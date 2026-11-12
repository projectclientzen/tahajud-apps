"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { buttonVariants } from "@/components/ui/button";
import { SCALEV_URL } from "./auth-shell";

/** Buttons on the entry page. A signed-in visitor goes straight to the dashboard (PRD §5.2). */
export function EntryActions() {
  const { status } = useAuth();
  const router = useRouter();
  React.useEffect(() => {
    if (status === "signedIn") router.replace("/dashboard");
  }, [status, router]);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link href="/login" className={buttonVariants({ size: "lg" })}>
        Masuk
      </Link>
      {SCALEV_URL ? (
        <a href={SCALEV_URL} className={buttonVariants({ size: "lg", variant: "secondary" })}>
          Beli akses di Scalev
        </a>
      ) : null}
    </div>
  );
}
