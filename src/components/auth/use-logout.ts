"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useData } from "@/components/providers/data-provider";
import { purgeUser } from "@/offline";

/**
 * Sign out of this device (PRD §21.4). Order matters: stop the queue, end the session, then delete
 * `tahajud-<userId>` so nothing can write into a database that is going away. The caller has already
 * made sure the notes are synced or the user agreed to drop them.
 */
export function useSignOut() {
  const router = useRouter();
  const { auth, refresh } = useAuth();
  const { queue, userId } = useData();
  return React.useCallback(async () => {
    await queue?.close();
    try {
      await auth?.logout();
    } finally {
      if (userId) await purgeUser(userId);
      await refresh();
      router.replace("/login");
    }
  }, [auth, queue, userId, refresh, router]);
}
