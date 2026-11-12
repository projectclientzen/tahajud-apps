"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { buttonVariants } from "@/components/ui/button";
import { SessionExpiredState } from "@/components/ui/feedback-state";
import { useAuth } from "@/components/providers/auth-provider";
import { DataProvider, errorMessage, useData } from "@/components/providers/data-provider";
import { PageSkeleton } from "@/components/providers/load-gate";
import Link from "next/link";

type Gate = "app" | "onboarding" | "access";

/**
 * Decides where a visitor may be. Checked once when a screen mounts, so dev tools that change data later
 * (for example loading another scenario) do not throw the user out of the page they are on.
 */
function AccessGate({ gate, children }: { gate: Gate; children: React.ReactNode }) {
  const { layer } = useData();
  const router = useRouter();
  const [state, setState] = React.useState<"checking" | "ok" | "redirecting" | "error">("checking");
  const [error, setError] = React.useState<unknown>(null);

  React.useEffect(() => {
    if (!layer) return;
    let alive = true;
    (async () => {
      try {
        const access = await layer.access.getAccess();
        const active = access.access_status === "active";
        // The profile needs an active entitlement, so it is only read for users who have one.
        const onboarded = active ? (await layer.profile.getProfile()).onboarding_completed : false;
        if (!alive) return;
        const target =
          gate === "access"
            ? active
              ? "/dashboard"
              : null
            : !active
              ? "/access-status"
              : gate === "app" && !onboarded
                ? "/onboarding"
                : gate === "onboarding" && onboarded
                  ? "/dashboard"
                  : null;
        if (target) {
          setState("redirecting");
          router.replace(target);
        } else setState("ok");
      } catch (e) {
        if (!alive) return;
        setError(e);
        setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [layer, gate, router]);

  if (state === "ok") return <>{children}</>;
  if (state === "error") {
    return (
      <p role="alert" className="m-4 rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
        {errorMessage(error)}
      </p>
    );
  }
  return (
    <div className="mx-auto max-w-md p-4">
      <PageSkeleton />
    </div>
  );
}

/** Requires a signed-in user, creates that user's data layer and offline queue, then applies the access gate. */
export function SignedInProviders({ gate, children }: { gate: Gate; children: React.ReactNode }) {
  const { status, session } = useAuth();
  const router = useRouter();
  const expired = status === "signedOut" && session?.reason === "expired";

  React.useEffect(() => {
    if (status === "signedOut" && !expired) router.replace("/login");
  }, [status, expired, router]);

  if (expired) {
    return (
      <div className="mx-auto max-w-md p-4">
        <SessionExpiredState
          action={
            <Link href="/login" className={buttonVariants()}>
              Masuk lagi
            </Link>
          }
        />
      </div>
    );
  }
  if (status !== "signedIn" || !session?.user) {
    return (
      <div className="mx-auto max-w-md p-4">
        <PageSkeleton />
      </div>
    );
  }
  return (
    <DataProvider userId={session.user.id}>
      <AccessGate gate={gate}>{children}</AccessGate>
    </DataProvider>
  );
}
