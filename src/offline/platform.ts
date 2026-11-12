export type InstallPlatform = "android" | "ios-safari" | "ios-other" | "desktop-chromium" | "desktop-other";

export interface PlatformInput {
  userAgent: string;
  /** Touch Macs report as "MacIntel" with touch points, so iPadOS needs this hint. */
  maxTouchPoints?: number;
  platform?: string;
}

/**
 * Best guess of where to explain "add to home screen". The user can still pick another guide.
 * iOS browsers other than Safari cannot install on older iOS, so they get a "open in Safari" hint.
 */
export function detectPlatform({ userAgent: ua, maxTouchPoints = 0, platform = "" }: PlatformInput): InstallPlatform {
  const iPadOs = platform === "MacIntel" && maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOs) {
    const other = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua);
    return other ? "ios-other" : "ios-safari";
  }
  if (/Android/.test(ua)) return "android";
  if (/Chrome|Chromium|Edg\//.test(ua) && !/OPR|Firefox/.test(ua)) return "desktop-chromium";
  return "desktop-other";
}

export interface StandaloneEnv {
  matchMedia?: (q: string) => { matches: boolean };
  /** iOS Safari only. */
  navigatorStandalone?: boolean;
}

/** True when the app runs as an installed PWA (`display-mode: standalone`). */
export function isStandalone(env: StandaloneEnv): boolean {
  return env.navigatorStandalone === true || !!env.matchMedia?.("(display-mode: standalone)").matches;
}
