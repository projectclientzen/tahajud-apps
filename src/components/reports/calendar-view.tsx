"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { errorMessage, useData, useLoad, useNow } from "@/components/providers/data-provider";
import { LoadGate } from "@/components/providers/load-gate";
import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip, StatusGlyph } from "@/components/ui/status-chip";
import { DISPLAY_STATUS_LABEL, SESSION_STATUSES } from "@/domain/content/session-status";
import { localDate } from "@/domain";
import type { CalendarResponse } from "@/data";
import { cn } from "@/lib/cn";
import { formatDateLong } from "@/lib/format-id";
import { formatMonth, monthEnd, monthGrid, monthOf, monthStart, shiftMonth, WEEKDAYS } from "./month";

type Day = CalendarResponse["days"][number];

const CELL: Record<Day["status"], string> = {
  completed: "bg-success-soft text-success",
  partial: "bg-warning-soft text-warning",
  missed: "bg-surface-2 text-text-muted",
  excused: "bg-info-soft text-info",
  upcoming: "border border-border-strong text-text",
};

function Detail({ day, onClose }: { day: Day; onClose: () => void }) {
  const { layer, bump } = useData();
  const { data } = useLoad((l) => l.report.getSessionHistory());
  const [error, setError] = React.useState<string | null>(null);
  const item = data?.sessions.find((s) => s.session_key === day.date);
  async function cancel() {
    try {
      await layer?.excuse.cancelExcuse(day.date);
      bump();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <StatusChip status={day.status} className="self-start" />
      {day.level ? <p>Level {day.level}</p> : null}
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
        <p role="alert" className="text-error">
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

export function CalendarScreen() {
  const now = useNow(60_000);
  const profile = useLoad((l) => l.profile.getProfile());
  const [month, setMonth] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Day | null>(null);

  const tz = profile.data?.timezone;
  const today = now && tz ? localDate(now, tz) : null;
  React.useEffect(() => {
    if (today && !month) setMonth(monthOf(today));
  }, [today, month]);

  const cal = useLoad(
    (l) => (month ? l.report.getCalendar(monthStart(month), monthEnd(month)) : Promise.resolve({ days: [] })),
    [month],
  );
  const first = profile.data?.program_start_date ? monthOf(profile.data.program_start_date) : null;
  const canPrev = !!month && !!first && month > first;
  const canNext = !!month && !!today && month < monthOf(today);
  const byDate = new Map((cal.data?.days ?? []).map((d) => [d.date, d]));

  return (
    <>
      <PageHeader
        title="Riwayat istiqomah"
        description="Satu bulan penuh. Ketuk tanggal untuk melihat detail."
        actions={
          <Link href="/reports" className={cn(buttonVariants({ variant: "secondary" }), "min-h-11 px-4")}>
            Laporan
          </Link>
        }
      />
      <LoadGate
        data={month ? cal.data : null}
        error={cal.error ?? profile.error}
        loading={cal.loading || !month}
        onRetry={cal.reload}
      >
        {() => (
          <Card className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="secondary"
                size="icon"
                aria-label="Bulan sebelumnya"
                disabled={!canPrev}
                onClick={() => setMonth(shiftMonth(month!, -1))}
              >
                <ChevronLeft aria-hidden className="size-5" />
              </Button>
              <h2 className="text-card-title font-semibold" data-testid="month-title">
                {formatMonth(month!)}
              </h2>
              <Button
                variant="secondary"
                size="icon"
                aria-label="Bulan berikutnya"
                disabled={!canNext}
                onClick={() => setMonth(shiftMonth(month!, 1))}
              >
                <ChevronRight aria-hidden className="size-5" />
              </Button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-helper text-text-muted" aria-hidden>
              {WEEKDAYS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <ol className="grid grid-cols-7 gap-1">
              {monthGrid(month!).map((date, i) => {
                const d = date ? byDate.get(date) : undefined;
                if (!date) return <li key={`pad-${i}`} aria-hidden />;
                if (!d)
                  return (
                    <li
                      key={date}
                      className="flex min-h-11 items-center justify-center text-helper text-text-muted tabular-nums"
                    >
                      {Number(date.slice(8))}
                    </li>
                  );
                return (
                  <li key={date}>
                    <button
                      type="button"
                      onClick={() => setSelected(d)}
                      aria-label={`${formatDateLong(d.date)}, ${DISPLAY_STATUS_LABEL[d.status]}`}
                      className={cn(
                        "flex min-h-11 w-full flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] text-helper font-medium",
                        CELL[d.status],
                      )}
                    >
                      <span className="tabular-nums">{Number(date.slice(8))}</span>
                      <StatusGlyph status={d.status} className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ol>
            <ul className="flex flex-wrap gap-2" aria-label="Keterangan status">
              {SESSION_STATUSES.map((s) => (
                <li key={s}>
                  <StatusChip status={s} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </LoadGate>
      <Sheet
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
        title={selected ? formatDateLong(selected.date) : "Detail malam"}
      >
        {selected ? <Detail day={selected} onClose={() => setSelected(null)} /> : null}
      </Sheet>
    </>
  );
}
