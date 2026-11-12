"use client";

import { RefreshCw } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { swStore } from "@/offline/sw-client";

const server = { updateReady: false, registered: false };

/** Shows when a new app version is waiting. Updating reloads the page, unsent notes stay in the queue. */
export function UpdatePrompt({
  preview = false,
}: {
  /** Show it even without an update. For the dev gallery only. */
  preview?: boolean;
}) {
  const { updateReady } = useSyncExternalStore(swStore.subscribe, swStore.getSnapshot, () => server);
  if (!updateReady && !preview) return null;
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-info-soft p-4 text-text sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <RefreshCw aria-hidden className="mt-0.5 size-5 shrink-0" />
        <p className="text-body">Versi baru tersedia. Catatan yang belum terkirim tetap aman.</p>
      </div>
      <Button type="button" variant="secondary" onClick={() => swStore.applyUpdate()} className="w-full sm:w-auto">
        Perbarui sekarang
      </Button>
    </div>
  );
}
