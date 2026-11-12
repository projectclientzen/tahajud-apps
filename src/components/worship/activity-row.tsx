"use client";

import { ChevronRight, Circle, CircleCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useData } from "@/components/providers/data-provider";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { SessionActivity } from "@/data";
import { cn } from "@/lib/cn";

/** Only optional items carry a visible tag. Required ones say so to screen readers and in the page legend. */
function Tag({ required }: { required: boolean }) {
  if (required) return <span className="sr-only">Syarat sesi tuntas</span>;
  return (
    <span className="inline-flex min-h-6 items-center rounded-full bg-surface-2 px-2 text-helper text-text-muted">
      Opsional
    </span>
  );
}

interface RowProps {
  activity: SessionActivity;
  onChanged: () => void;
  onError: (message: string) => void;
}

/** Checklist items toggle in place. Counter items open the counter screen. */
export function ActivityRow({ activity: a, onChanged, onError }: RowProps) {
  const { queue } = useData();
  const [saving, setSaving] = React.useState(false);
  // The tick the user chose, shown at once and held until the server value catches up. Also rebuilt from the
  // offline queue after a reload, so a tick made offline is still on screen (PRD §21.1).
  const [local, setLocal] = React.useState<boolean | null>(null);
  const checklist = a.kind === "checklist";
  const localRef = React.useRef<boolean | null>(null);
  localRef.current = local;
  const changed = React.useRef(onChanged);
  changed.current = onChanged;
  const fail = React.useRef(onError);
  fail.current = onError;

  React.useEffect(() => {
    if (local !== null && a.checked === local) setLocal(null);
  }, [a.checked, local]);

  // Follow the queue: pick up ticks saved earlier, and react when they are sent or refused.
  React.useEffect(() => {
    if (!queue || !checklist) return;
    let alive = true;
    const sync = async () => {
      const waiting = (await queue.listPending(a.id)).filter((i) => i.operation_type === "checklist_set");
      if (!alive) return;
      const last = waiting.at(-1);
      if (last) {
        setLocal((cur) => cur ?? (last.payload as { checked: boolean }).checked);
        return;
      }
      const refused = (await queue.listRejected()).filter((i) => i.entity_id === a.id);
      if (!alive) return;
      if (refused.length > 0) {
        await queue.dismissRejected(refused.map((i) => i.operation_id));
        setLocal(null);
        fail.current("Perubahan centang tidak diterima server. Sesi malam itu mungkin sudah ditutup.");
      }
      // Sent or refused: read the server value again. Rows with no change of their own stay quiet.
      if (localRef.current !== null || refused.length > 0) changed.current();
    };
    void sync();
    const off = queue.subscribe(() => void sync());
    return () => {
      alive = false;
      off();
    };
  }, [queue, checklist, a.id]);

  if (a.kind === "counter") {
    const target = a.target ?? 0;
    return (
      <li id={`act-${a.id}`}>
        <Link
          href={`/worship/dhikr/${encodeURIComponent(a.id)}`}
          className="flex min-h-16 items-center gap-3 rounded-[var(--radius-control)] p-3 hover:bg-surface-2"
        >
          {a.completed ? (
            <CircleCheck aria-hidden className="size-7 shrink-0 text-success" strokeWidth={2} />
          ) : (
            <Circle aria-hidden className="size-7 shrink-0 text-border-strong" strokeWidth={1.75} />
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{a.title}</span>
              <Tag required={a.required} />
            </div>
            <span className="text-helper tabular-nums text-text-muted">
              {a.count} dari {target}
              {a.unit ? ` ${a.unit}` : ""}
              {a.completed ? ", selesai" : ""}
            </span>
            <ProgressBar
              hideText
              label={a.completed ? "Selesai" : "Hitungan"}
              value={Math.min(a.count, target)}
              max={Math.max(target, 1)}
              valueText={`${a.count} dari ${target}${a.unit ? ` ${a.unit}` : ""}`}
            />
          </div>
          <ChevronRight aria-hidden className="size-5 shrink-0 text-text-muted" />
        </Link>
      </li>
    );
  }

  async function toggle() {
    if (!queue) return;
    const next = !(local ?? a.checked);
    setSaving(true);
    setLocal(next);
    try {
      // Into the offline queue first, then out. The server dedupes by operation_id and resolves version clashes.
      await queue.enqueue({
        operation_id: crypto.randomUUID(),
        entity_id: a.id,
        operation_type: "checklist_set",
        payload: { checked: next, version: a.version },
      });
    } catch {
      setLocal(null);
      onError("Centang belum bisa disimpan. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  const note = a.type === "quran" ? "Reader menyusul. Centang setelah selesai membaca." : a.guidance;
  return (
    <li id={`act-${a.id}`}>
      <label
        className={cn(
          "flex min-h-16 items-start gap-3 rounded-[var(--radius-control)] p-3 hover:bg-surface-2",
          saving && "opacity-60",
        )}
      >
        <input
          type="checkbox"
          className="mt-0 size-7 shrink-0 accent-[var(--primary)]"
          checked={local ?? a.checked}
          disabled={saving}
          onChange={toggle}
        />
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {a.title}
              {a.target ? `, ${a.target}${a.unit ? ` ${a.unit}` : ""}` : ""}
            </span>
            <Tag required={a.required} />
          </span>
          {note ? <span className="text-helper text-text-muted">{note}</span> : null}
        </span>
      </label>
    </li>
  );
}
