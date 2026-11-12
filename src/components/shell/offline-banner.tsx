"use client";

import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" className="flex items-center gap-2 bg-warning-soft px-4 py-2 text-helper text-text">
      <WifiOff aria-hidden className="size-4 shrink-0" />
      Kamu sedang offline. Catatan tetap tersimpan di perangkat dan dikirim saat online.
    </div>
  );
}
