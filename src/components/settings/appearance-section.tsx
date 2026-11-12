"use client";

import { Minus, Plus } from "lucide-react";
import * as React from "react";
import { errorMessage, useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { getAmalan } from "@/domain/content";
import type { Profile } from "@/data";
import { cn } from "@/lib/cn";
import { THEME_OPTIONS, THEME_STORAGE_KEY, type ThemePreference } from "@/lib/theme";
import { Section, SaveNote, type SaveState } from "./controls";
import { applyThemePref } from "./theme-control";

const QURAN = { min: 24, max: 44, step: 2 } as const;
const DHIKR = { min: 26, max: 34, step: 2 } as const;

function Stepper({
  label,
  value,
  range,
  testId,
  onChange,
}: {
  label: string;
  value: number;
  range: { min: number; max: number; step: number };
  testId: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="icon"
          aria-label={`Perkecil ${label}`}
          disabled={value <= range.min}
          onClick={() => onChange(value - range.step)}
        >
          <Minus aria-hidden className="size-5" />
        </Button>
        <span data-testid={testId} className="min-w-14 text-center tabular-nums">
          {value} px
        </span>
        <Button
          variant="secondary"
          size="icon"
          aria-label={`Perbesar ${label}`}
          disabled={value >= range.max}
          onClick={() => onChange(value + range.step)}
        >
          <Plus aria-hidden className="size-5" />
        </Button>
      </div>
    </div>
  );
}

export function AppearanceSection({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const { layer } = useData();
  const [note, setNote] = React.useState<SaveState>({ kind: "idle" });
  // Teks dzikir dari konten owner, bukan teks ayat.
  const sample = Object.values(getAmalan().dhikr)[0];

  // The device keeps its own theme in localStorage (pre-paint script). The profile value only fills in when the device has none.
  const [pref, setPref] = React.useState<ThemePreference>(profile.theme_pref);
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored && THEME_OPTIONS.some((o) => o.value === stored)) setPref(stored as ThemePreference);
      else applyThemePref(profile.theme_pref);
    } catch {
      /* storage blocked: show the profile value */
    }
    // Read once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(patch: Parameters<NonNullable<typeof layer>["profile"]["updatePreferences"]>[0]) {
    if (!layer) return;
    try {
      onChange(await layer.profile.updatePreferences(patch));
      setNote({ kind: "saved", text: "Tersimpan." });
    } catch (e) {
      setNote({ kind: "error", text: errorMessage(e) });
    }
  }

  return (
    <Section id="tampilan" title="Tampilan" description="Tema dan ukuran huruf Arab. Perubahan langsung tersimpan.">
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 font-medium">Tema</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEME_OPTIONS.map((o) => {
            const on = pref === o.value;
            return (
              <label
                key={o.value}
                className={cn(
                  "flex min-h-12 items-center justify-center rounded-[var(--radius-control)] border px-3 text-center text-helper font-medium has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
                  on ? "border-primary bg-primary-soft text-text" : "border-border-strong bg-surface text-text-muted",
                )}
              >
                <input
                  type="radio"
                  name="theme"
                  className="sr-only"
                  checked={on}
                  onChange={() => {
                    setPref(o.value as ThemePreference);
                    applyThemePref(o.value as ThemePreference);
                    void save({ theme_pref: o.value as ThemePreference });
                  }}
                />
                {o.label}
              </label>
            );
          })}
        </div>
      </fieldset>
      <Stepper
        label="Huruf Al-Qur'an"
        value={profile.quran_font_size}
        range={QURAN}
        testId="font-quran"
        onChange={(v) => save({ quran_font_size: v })}
      />
      <Stepper
        label="Huruf dzikir"
        value={profile.dhikr_font_size}
        range={DHIKR}
        testId="font-dhikr"
        onChange={(v) => save({ dhikr_font_size: v })}
      />
      {sample ? (
        <div className="rounded-[var(--radius-control)] bg-surface-2 p-4">
          <p className="pb-2 text-helper text-text-muted">Contoh teks dzikir pada ukuran dzikir</p>
          <p
            className="arabic text-start leading-[2.2]"
            lang="ar"
            dir="rtl"
            style={{ fontSize: profile.dhikr_font_size }}
          >
            {sample.arabicText}
          </p>
        </div>
      ) : null}
      <SaveNote state={note} />
    </Section>
  );
}
