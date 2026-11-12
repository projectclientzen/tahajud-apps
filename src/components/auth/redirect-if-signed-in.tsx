"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";

/** The entry page is for visitors. Someone already signed in goes straight to the dashboard (PRD §5.2). */
export function RedirectIfSignedIn() {
  const router = useRouter();
  const { session } = useAuth();
  const authed = session?.authenticated === true;
  React.useEffect(() => {
    if (authed) router.replace("/dashboard");
  }, [authed, router]);
  return null;
}
