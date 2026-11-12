"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useData } from "@/components/providers/data-provider";
import { purgeUser } from "@/offline";

/**
 * Sign out of this device: stop syncing, end the session, delete this user's local database
 * (queue and cached data, SECURITY-06), then go to the login screen.
 */
export function useSignOut() {
  const { auth, refresh } = useAuth();
  const { userId, shutdown } = useData();
  const router = useRouter();
  return React.useCallback(async () => {
    shutdown();
    await auth?.logout();
    await purgeUser(userId);
    await refresh();
    router.replace("/login");
  }, [auth, refresh, router, shutdown, userId]);
}
