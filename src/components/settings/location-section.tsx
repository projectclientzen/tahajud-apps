"use client";

import * as React from "react";
import { errorMessage, useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { ID_TIMEZONES } from "@/domain";
import type { PrayerTime, Profile, Region } from "@/data";
import { formatClock, tzLabel } from "@/lib/format-id";
import { ScheduleNote } from "./schedule-note";
import { Field, Section, SaveNote, SelectInput, TextInput, type SaveState } from "./controls";

const toInput = (iso: string | null, tz: string) => (iso ? formatClock(iso, tz).replace(".", ":") : "");

export function LocationSection({ profile, regions, fajr }: { profile: Profile; regions: Region[]; fajr: PrayerTime }) {
  const { layer, bump } = useData();
  const [mode, setMode] = React.useState(profile.schedule_mode);
  const [regionId, setRegionId] = React.useState(profile.region_id ?? regions[0]?.id ?? "");
  const [tz, setTz] = React.useState(profile.timezone);
  const [fajrTime, setFajrTime] = React.useState(toInput(fajr.fajr_at, fajr.timezone));
  const [maghrib, setMaghrib] = React.useState(toInput(fajr.maghrib_at, fajr.timezone));
  const [note, setNote] = React.useState<SaveState>({ kind: "idle" });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!layer) return;
    try {
      const r =
        mode === "region"
          ? await layer.profile.setLocation({ mode: "region", region_id: regionId })
          : await layer.profile.setLocation({
              mode: "manual",
              timezone: tz,
              fajr_time: fajrTime,
              ...(maghrib ? { maghrib_time: maghrib } : {}),
            });
      bump();
      setNote({ kind: "saved", text: `Tersimpan. ${r.label ?? "Jadwal diperbarui"}. Berlaku mulai sesi berikutnya.` });
    } catch (err) {
      setNote({ kind: "error", text: errorMessage(err) });
    }
  }

  const manualOk = /^\d{2}:\d{2}$/.test(fajrTime);
  return (
    <Section
      id="wilayah"
      title="Wilayah dan jadwal Subuh"
      description="Pilih wilayah, atau isi jam Subuh sendiri jika jadwal otomatis tidak cocok."
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="sr-only">Sumber jadwal</legend>
          {(
            [
              ["region", "Pilih wilayah"],
              ["manual", "Atur manual"],
            ] as const
          ).map(([v, l]) => (
            <label
              key={v}
              className={`flex min-h-12 items-center justify-center rounded-[var(--radius-control)] border px-3 font-medium has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${mode === v ? "border-primary bg-primary-soft" : "border-border-strong text-text-muted"}`}
            >
              <input
                type="radio"
                name="schedule-mode"
                className="sr-only"
                checked={mode === v}
                onChange={() => setMode(v)}
              />
              {l}
            </label>
          ))}
        </fieldset>
        {mode === "region" ? (
          <Field htmlFor="region" label="Wilayah">
            <SelectInput id="region" value={regionId} onChange={(e) => setRegionId(e.target.value)}>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name.includes("(") ? r.name : `${r.name} (${tzLabel(r.timezone)})`}
                </option>
              ))}
            </SelectInput>
          </Field>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field htmlFor="tz" label="Zona waktu">
              <SelectInput id="tz" value={tz} onChange={(e) => setTz(e.target.value)}>
                {ID_TIMEZONES.map((z) => (
                  <option key={z} value={z}>
                    {tzLabel(z)}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field htmlFor="fajr-time" label="Jam Subuh">
              <TextInput id="fajr-time" type="time" value={fajrTime} onChange={(e) => setFajrTime(e.target.value)} />
            </Field>
            <Field htmlFor="maghrib-time" label="Jam Maghrib (opsional)" hint="Dipakai untuk jendela Bacaan Jumat.">
              <TextInput id="maghrib-time" type="time" value={maghrib} onChange={(e) => setMaghrib(e.target.value)} />
            </Field>
          </div>
        )}
        <ScheduleNote fajr={fajr} />
        <Button type="submit" disabled={mode === "manual" && !manualOk} className="self-start">
          Simpan wilayah
        </Button>
        <SaveNote state={note} />
      </form>
    </Section>
  );
}
