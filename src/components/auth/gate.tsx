"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { OfflineState } from "@/components/ui/feedback-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { Access } from "@/data";
import { GUARD_PATHS, guardRedirect, type GuardNeed } from "@/domain/auth/route-guard";

export function GateSkeleton() {
  return (
    <div role="status" aria-label="Memuat" className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-10">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

/**
 * Guards a route group (PRD §6.1, §6.4): not signed in goes to /login, signed in without access goes to
 * /access-status, not onboarded goes to /onboarding. The data layer answers about access, so the server
 * stays the judge. If that answer cannot be fetched (offline), the page opens and shows its own state.
 */
export function AppGate({ need, children }: { need: GuardNeed; children: React.ReactNode }) {
  const router = useRouter();
  const { ready, session, unreachable, refresh } = useAuth();
  const { layer } = useData();
  const [access, setAccess] = React.useState<Access | null>(null);
  const [accessChecked, setAccessChecked] = React.useState(false);
  const authed = session?.authenticated === true;

  React.useEffect(() => {
    if (!layer || !authed) {
      setAccess(null);
      setAccessChecked(false);
      return;
    }
    let alive = true;
    layer.access.getAccess().then(
      (a) => alive && (setAccess(a), setAccessChecked(true)),
      () => alive && (setAccess(null), setAccessChecked(true)),
    );
    return () => {
      alive = false;
    };
  }, [layer, authed]);

  const target = React.useMemo(() => {
    if (!ready || unreachable) return null;
    if (!authed) {
      return guardRedirect(need, { authenticated: false, signedOutReason: session?.reason ?? "none" });
    }
    if (!accessChecked || !access) return null;
    return guardRedirect(need, {
      authenticated: true,
      accessStatus: access.access_status,
      onboardingCompleted: access.onboarding_completed,
    });
  }, [ready, unreachable, authed, session?.reason, need, access, accessChecked]);

  React.useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (unreachable) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-10">
        <OfflineState
          title="Belum bisa memeriksa akunmu"
          description="Cek koneksi internet, lalu coba lagi. Catatan di perangkat ini tetap aman."
          action={
            <Button variant="secondary" onClick={() => void refresh()}>
              Coba lagi
            </Button>
          }
        />
      </div>
    );
  }
  if (!ready || target) return <GateSkeleton />;
  if (authed && !accessChecked) return <GateSkeleton />;
  return <>{children}</>;
}

/** Sign-in screens: someone who is already signed in has no business here. */
export function GuestOnly({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { ready, session } = useAuth();
  const authed = session?.authenticated === true;
  React.useEffect(() => {
    if (authed) router.replace(GUARD_PATHS.dashboard);
  }, [authed, router]);
  if (!ready || authed) return <GateSkeleton />;
  return <>{children}</>;
}
