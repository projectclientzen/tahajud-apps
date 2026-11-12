"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useData } from "@/components/providers/data-provider";
import { PLANNER_KEY } from "@/components/settings/planner-prefs";
import { purgeUser } from "@/offline";

/**
 * Sign out of this device: stop syncing, end the session, delete this user's local database
 * (queue and cached data) and planner settings (SECURITY-06), then go to the login screen.
 */
export function useSignOut() {
  const { auth, refresh } = useAuth();
  const { userId, shutdown } = useData();
  const router = useRouter();
  return React.useCallback(async () => {
    shutdown();
    await auth?.logout();
    await purgeUser(userId);
    // Per-user settings kept in localStorage must not stay behind on a shared device (SECURITY-06).
    // The theme stays: it belongs to the device, not the account.
    try {
      window.localStorage.removeItem(PLANNER_KEY);
    } catch {
      /* storage blocked: nothing was stored */
    }
    await refresh();
    router.replace("/login");
  }, [auth, refresh, router, shutdown, userId]);
}
