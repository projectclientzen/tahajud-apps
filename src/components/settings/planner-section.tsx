"use client";

import * as React from "react";
import { errorMessage, useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import type { LevelNumber } from "@/domain/config/provisional";
import type { NotificationPreferences, PrayerTime } from "@/data";
import { formatClock, tzLabel } from "@/lib/format-id";
import { Field, Section, SaveNote, TextInput, type SaveState } from "./controls";
import { BUFFER_RANGE, DURATION_RANGE, readPlannerPrefs, writePlannerPrefs, type PlannerPrefs } from "./planner-prefs";
import { buildPlannerPreview } from "./planner-preview";

interface Props {
  prefs: NotificationPreferences;
  onPrefs: (p: NotificationPreferences) => void;
  fajr: PrayerTime;
  level: LevelNumber;
}

export function PlannerSection({ prefs, onPrefs, fajr, level }: Props) {
  const { layer } = useData();
  const [planner, setPlanner] = React.useState<PlannerPrefs | null>(null);
  const [sleep, setSleep] = React.useState(prefs.bedtime.target_sleep_time);
  const [note, setNote] = React.useState<SaveState>({ kind: "idle" });
  React.useEffect(() => setPlanner(readPlannerPrefs()), []);
  if (!planner) return null;

  const num = (v: string) => (v === "" ? NaN : Number(v));
  const valid =
    ([1, 2, 3] as const).every(
      (l) => planner.durations[l] >= DURATION_RANGE.min && planner.durations[l] <= DURATION_RANGE.max,
    ) &&
    planner.bufferMinutes >= BUFFER_RANGE.min &&
    planner.bufferMinutes <= BUFFER_RANGE.max &&
    /^\d{2}:\d{2}$/.test(sleep);

  const preview =
    valid && fajr.fajr_at
      ? buildPlannerPreview({
          fajrAt: new Date(fajr.fajr_at),
          tz: fajr.timezone,
          level,
          prefs: planner,
          targetSleep: sleep,
        })
      : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!layer || !planner) return;
    try {
      writePlannerPrefs(planner);
      onPrefs(
        await layer.notifications.putPreferences({ ...prefs, bedtime: { ...prefs.bedtime, target_sleep_time: sleep } }),
      );
      setNote({ kind: "saved", text: "Tersimpan." });
    } catch (err) {
      setNote({ kind: "error", text: errorMessage(err) });
    }
  }

  const setDur = (l: LevelNumber, v: number) => setPlanner({ ...planner, durations: { ...planner.durations, [l]: v } });

  return (
    <Section
      id="jam-bangun"
      title="Jam bangun"
      description="Jam bangun = Subuh dikurangi durasi ibadah dan waktu persiapan. Angka awal masih usulan (belum disetujui)."
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {([1, 2, 3] as const).map((l) => (
            <Field key={l} htmlFor={`dur-${l}`} label={`Durasi Level ${l} (menit)`}>
              <TextInput
                id={`dur-${l}`}
                type="number"
                inputMode="numeric"
                min={DURATION_RANGE.min}
                max={DURATION_RANGE.max}
                value={Number.isNaN(planner.durations[l]) ? "" : planner.durations[l]}
                onChange={(e) => setDur(l, num(e.target.value))}
              />
            </Field>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="buffer" label="Waktu persiapan (menit)" hint="Wudu dan bersiap sebelum mulai.">
            <TextInput
              id="buffer"
              type="number"
              inputMode="numeric"
              min={BUFFER_RANGE.min}
              max={BUFFER_RANGE.max}
              value={Number.isNaN(planner.bufferMinutes) ? "" : planner.bufferMinutes}
              onChange={(e) => setPlanner({ ...planner, bufferMinutes: num(e.target.value) })}
            />
          </Field>
          <Field htmlFor="sleep" label="Target tidur">
            <TextInput id="sleep" type="time" value={sleep} onChange={(e) => setSleep(e.target.value)} />
          </Field>
        </div>
        <div className="rounded-[var(--radius-control)] bg-surface-2 p-4" aria-live="polite">
          {preview ? (
            <>
              <p>
                Perkiraan bangun malam ini:{" "}
                <strong data-testid="wake-preview">
                  {formatClock(preview.wakeAt.toISOString(), fajr.timezone)} {tzLabel(fajr.timezone)}
                </strong>{" "}
                untuk Level {level}.
              </p>
              {preview.sleepWarning ? <p className="pt-2 text-text-muted">{preview.sleepWarning}</p> : null}
            </>
          ) : (
            <p className="text-text-muted">
              {valid
                ? "Jadwal Subuh belum tersedia. Atur wilayah atau jadwal manual di bawah."
                : "Isi angka di rentang yang diizinkan."}
            </p>
          )}
        </div>
        <Button type="submit" disabled={!valid} className="self-start">
          Simpan jam bangun
        </Button>
        <SaveNote state={note} />
      </form>
    </Section>
  );
}
