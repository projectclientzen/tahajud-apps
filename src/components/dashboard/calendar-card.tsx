"use client";

import * as React from "react";
import { errorMessage, useData, useLoad } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip, StatusGlyph } from "@/components/ui/status-chip";
import { SESSION_STATUS_LABEL, SESSION_STATUSES } from "@/domain/content/session-status";
import type { Dashboard } from "@/data";
import { cn } from "@/lib/cn";
import { dayOfMonth, formatDateLong, formatDateShort } from "@/lib/format-id";
import { levelTitle } from "./content-lookup";

type Day = Dashboard["calendar_days"][number];

const CELL: Record<Day["status"], string> = {
  completed: "bg-success-soft text-success",
  partial: "bg-warning-soft text-warning",
  missed: "bg-surface-2 text-text-muted",
  excused: "bg-info-soft text-info",
  upcoming: "border border-border-strong text-text",
};

function DayDetail({ day, onClose }: { day: Day; onClose: () => void }) {
  const { layer, bump } = useData();
  const { data } = useLoad((l) => l.report.getSessionHistory());
  const [error, setError] = React.useState<string | null>(null);
  const item = data?.sessions.find((s) => s.session_key === day.date);

  async function cancel() {
    if (!layer) return;
    try {
      await layer.excuse.cancelExcuse(day.date);
      bump();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <StatusChip status={day.status} className="self-start" />
      {day.level ? (
        <p>
          Level {day.level}: {levelTitle(day.level)}
        </p>
      ) : null}
      {item ? (
        <p>
          Syarat sesi tuntas: {item.required_done} dari {item.required_total}.
        </p>
      ) : (
        <p className="text-text-muted">
          {day.status === "excused" ? "Malam ini ditandai berhalangan." : "Belum ada catatan ibadah di malam ini."}
        </p>
      )}
      {error ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
          {error}
        </p>
      ) : null}
      {day.status === "excused" ? (
        <Button variant="secondary" onClick={cancel}>
          Batalkan berhalangan
        </Button>
      ) : null}
    </div>
  );
}

/** Section E: last 30 nights. Each day carries an icon and a label, and opens its detail. */
export function CalendarCard({ days }: { days: Day[] }) {
  const [selected, setSelected] = React.useState<Day | null>(null);
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>Riwayat istiqomah</CardTitle>
      {days.length === 0 ? (
        <p className="text-text-muted">Kalender terisi setelah malam pertamamu.</p>
      ) : (
        <ol className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
          {days.map((d) => (
            <li key={d.date}>
              <button
                type="button"
                onClick={() => setSelected(d)}
                aria-label={`${formatDateShort(d.date)}, ${SESSION_STATUS_LABEL[d.status]}`}
                className={cn(
                  "flex min-h-11 w-full min-w-11 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] text-helper font-medium",
                  CELL[d.status],
                )}
              >
                <span className="tabular-nums">{dayOfMonth(d.date)}</span>
                <StatusGlyph status={d.status} className="size-3.5" />
              </button>
            </li>
          ))}
        </ol>
      )}
      <ul className="flex flex-wrap gap-2" aria-label="Keterangan status">
        {SESSION_STATUSES.map((s) => (
          <li key={s}>
            <StatusChip status={s} />
          </li>
        ))}
      </ul>
      <Sheet
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected ? formatDateLong(selected.date) : "Detail malam"}
      >
        {selected ? <DayDetail day={selected} onClose={() => setSelected(null)} /> : null}
      </Sheet>
    </Card>
  );
}
