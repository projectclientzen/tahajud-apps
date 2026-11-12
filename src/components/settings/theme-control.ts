import { applyThemeFromStorage, resolveTheme, THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";

/** Same mechanism as the shell toggle: localStorage feeds the pre-paint script, then apply now. */
export function applyThemePref(next: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    /* storage blocked: still apply for this page view */
  }
  applyThemeFromStorage((_p, systemDark, minutes) => resolveTheme(next, systemDark, minutes), THEME_STORAGE_KEY);
}

export function currentTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
