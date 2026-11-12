export type ThemePreference = "system" | "light" | "dark" | "auto-night";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "tt-theme";

export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Ikuti perangkat" },
  { value: "light", label: "Terang" },
  { value: "dark", label: "Gelap" },
  { value: "auto-night", label: "Gelap saat malam" },
];

/**
 * Resolve the theme to apply. Self-contained (no outer references) because
 * its source is inlined into the pre-paint script in layout.tsx.
 *
 * auto-night: dark between nightStart and nightEnd (minutes from local midnight).
 * Until the prayer engine lands (S2/S7) the window is a fixed 18:00 to 05:00
 * stand-in for Maghrib to Subuh.
 */
export function resolveTheme(
  pref: string | null,
  systemDark: boolean,
  localMinutes: number,
  nightStart = 18 * 60,
  nightEnd = 5 * 60,
): ResolvedTheme {
  if (pref === "light" || pref === "dark") return pref;
  if (pref === "auto-night") {
    const isNight =
      nightStart > nightEnd
        ? localMinutes >= nightStart || localMinutes < nightEnd
        : localMinutes >= nightStart && localMinutes < nightEnd;
    return isNight ? "dark" : "light";
  }
  return systemDark ? "dark" : "light";
}

export function applyThemeFromStorage(resolve: typeof resolveTheme, key: string) {
  try {
    let pref: string | null = null;
    try {
      pref = window.localStorage.getItem(key);
    } catch {
      pref = null;
    }
    const now = new Date();
    const theme = resolve(
      pref,
      window.matchMedia("(prefers-color-scheme: dark)").matches,
      now.getHours() * 60 + now.getMinutes(),
    );
    document.documentElement.dataset.theme = theme;
  } catch {
    /* leave CSS fallback in place */
  }
}

export const themeInitScript = `(${applyThemeFromStorage.toString()})(${resolveTheme.toString()}, ${JSON.stringify(THEME_STORAGE_KEY)});`;
