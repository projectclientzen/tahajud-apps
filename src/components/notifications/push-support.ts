import type { InstallPlatform } from "@/offline/platform";

export type PushState = "needs_install" | "unsupported" | "denied" | "can_ask" | "granted";

export interface PushEnv {
  hasPushManager: boolean;
  hasNotification: boolean;
  platform: InstallPlatform;
  standalone: boolean;
  permission: "default" | "granted" | "denied" | null;
}

/** Order matters: iOS outside the installed app cannot subscribe at all, so it gets install steps first (PRD §15.3). */
export function pushState(e: PushEnv): PushState {
  const ios = e.platform === "ios-safari" || e.platform === "ios-other";
  if (ios && !e.standalone) return "needs_install";
  if (!e.hasPushManager || !e.hasNotification) return "unsupported";
  if (e.permission === "denied") return "denied";
  if (e.permission === "granted") return "granted";
  return "can_ask";
}
