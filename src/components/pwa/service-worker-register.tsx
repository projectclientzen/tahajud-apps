"use client";

import { useEffect } from "react";
import { swEnabled, swStore } from "@/offline/sw-client";

/** Registers `/sw.js` in production, or when NEXT_PUBLIC_ENABLE_SW=true. Renders nothing. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    void swStore.register({
      serviceWorker: "serviceWorker" in navigator ? navigator.serviceWorker : undefined,
      enabled: swEnabled({ NODE_ENV: process.env.NODE_ENV, NEXT_PUBLIC_ENABLE_SW: process.env.NEXT_PUBLIC_ENABLE_SW }),
      reload: () => window.location.reload(),
    });
  }, []);
  return null;
}
