"use client";

import * as React from "react";
import { errorMessage, useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import type { NotificationPreferences } from "@/data";
import { Field, Section, SaveNote, Switch, TextInput, type SaveState } from "./controls";

const TYPES = [
  ["bedtime", "Pengingat tidur"],
  ["tahajud", "Pengingat tahajud"],
  ["fajr", "Pengingat Subuh"],
  ["alkahfi", "Bacaan Jumat"],
  ["achievement", "Level baru terbuka"],
] as const;

export function NotificationSection({
  prefs,
  onPrefs,
}: {
  prefs: NotificationPreferences;
  onPrefs: (p: NotificationPreferences) => void;
}) {
  const { layer } = useData();
  const [draft, setDraft] = React.useState(prefs);
  const [note, setNote] = React.useState<SaveState>({ kind: "idle" });
  React.useEffect(() => setDraft(prefs), [prefs]);

  const q = draft.quiet_hours;
  const timeOk = /^\d{2}:\d{2}$/.test(q.start) && /^\d{2}:\d{2}$/.test(q.end);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!layer) return;
    try {
      onPrefs(await layer.notifications.putPreferences(draft));
      setNote({ kind: "saved", text: "Tersimpan." });
    } catch (err) {
      setNote({ kind: "error", text: errorMessage(err) });
    }
  }

  return (
    <Section
      id="pengingat"
      title="Notifikasi"
      description="Pengingat bersifat usaha terbaik. Tetap pasang alarm di perangkat sebagai cadangan."
    >
      <form onSubmit={save} className="flex flex-col gap-3">
        {TYPES.map(([key, label]) => (
          <Switch
            key={key}
            label={label}
            checked={draft[key].enabled}
            onChange={(v) => setDraft({ ...draft, [key]: { ...draft[key], enabled: v } })}
          />
        ))}
        <Field htmlFor="bedtime-offset" label="Pengingat tidur dikirim sebelum target tidur (menit)">
          <TextInput
            id="bedtime-offset"
            type="number"
            inputMode="numeric"
            min={0}
            max={240}
            value={draft.bedtime.offset_minutes}
            onChange={(e) =>
              setDraft({
                ...draft,
                bedtime: { ...draft.bedtime, offset_minutes: Math.max(0, Math.floor(Number(e.target.value) || 0)) },
              })
            }
          />
        </Field>
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <Switch
            label="Jam tenang"
            hint="Tidak ada notifikasi di rentang ini."
            checked={q.enabled}
            onChange={(v) => setDraft({ ...draft, quiet_hours: { ...q, enabled: v } })}
          />
          {q.enabled ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field htmlFor="quiet-start" label="Mulai">
                  <TextInput
                    id="quiet-start"
                    type="time"
                    value={q.start}
                    onChange={(e) => setDraft({ ...draft, quiet_hours: { ...q, start: e.target.value } })}
                  />
                </Field>
                <Field htmlFor="quiet-end" label="Selesai">
                  <TextInput
                    id="quiet-end"
                    type="time"
                    value={q.end}
                    onChange={(e) => setDraft({ ...draft, quiet_hours: { ...q, end: e.target.value } })}
                  />
                </Field>
              </div>
              <Switch
                label="Tetap kirim pengingat tahajud dan Subuh"
                checked={q.allow_worship}
                onChange={(v) => setDraft({ ...draft, quiet_hours: { ...q, allow_worship: v } })}
              />
            </>
          ) : null}
        </div>
        <Button type="submit" disabled={!timeOk} className="self-start">
          Simpan notifikasi
        </Button>
        <SaveNote state={note} />
      </form>
    </Section>
  );
}
