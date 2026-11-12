"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { errorMessage, useData } from "@/components/providers/data-provider";
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
  const { layer } = useData();
  const [pending, setPending] = React.useState(false);
  // Shows the tick at once and holds it until the server value catches up.
  const [local, setLocal] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (local !== null && a.checked === local) setLocal(null);
  }, [a.checked, local]);

  if (a.kind === "counter") {
    const target = a.target ?? 0;
    return (
      <li>
        <Link
          href={`/worship/dhikr/${encodeURIComponent(a.id)}`}
          className="flex min-h-14 items-center gap-3 rounded-[var(--radius-control)] p-3 hover:bg-surface-2"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{a.title}</span>
              <Tag required={a.required} />
            </div>
            <ProgressBar
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
    if (!layer) return;
    setPending(true);
    setLocal(!a.checked);
    try {
      await layer.session.setChecklist(a.id, { checked: !a.checked, version: a.version });
    } catch (e) {
      setLocal(null);
      onError(errorMessage(e));
    } finally {
      setPending(false);
      onChanged();
    }
  }

  const note = a.type === "quran" ? "Reader menyusul. Centang setelah selesai membaca." : a.guidance;
  return (
    <li>
      <label
        className={cn(
          "flex min-h-14 items-start gap-3 rounded-[var(--radius-control)] p-3 hover:bg-surface-2",
          pending && "opacity-60",
        )}
      >
        <input
          type="checkbox"
          className="mt-0.5 size-6 shrink-0 accent-[var(--primary)]"
          checked={local ?? a.checked}
          disabled={pending}
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
