"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import {
  applyThemeFromStorage,
  resolveTheme,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

function readPref(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto-night" || v === "system") return v;
  } catch {
    /* storage blocked */
  }
  return "system";
}

/** Native radios: arrow keys and screen readers work without extra code. */
export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>("system");

  useEffect(() => setPref(readPref()), []);

  function choose(next: ThemePreference) {
    setPref(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage blocked: still apply for this page view */
    }
    applyThemeFromStorage((_p, systemDark, minutes) => resolveTheme(next, systemDark, minutes), THEME_STORAGE_KEY);
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-2 font-semibold">Tampilan</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {THEME_OPTIONS.map((opt) => {
          const selected = pref === opt.value;
          return (
            <label
              key={opt.value}
              className={cn(
                "flex min-h-12 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border px-3 text-center text-helper font-medium transition-colors duration-[var(--dur-fast)]",
                "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
                selected
                  ? "border-primary bg-primary-soft text-text"
                  : "border-border-strong bg-surface text-text-muted hover:text-text",
              )}
            >
              <input
                type="radio"
                name="theme"
                value={opt.value}
                checked={selected}
                onChange={() => choose(opt.value)}
                className="sr-only"
              />
              {opt.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
