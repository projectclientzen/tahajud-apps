"use client";

import * as React from "react";
import { useLoad } from "@/components/providers/data-provider";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/cn";
import { formatRate } from "@/lib/format-id";

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

/** Section D: status counts and completion rate for the last 7, 30 or 90 closed nights. */
export function SummaryCard() {
  const [period, setPeriod] = React.useState<Period>(7);
  const { data } = useLoad((l) => l.report.getReport(period), [period]);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>Ringkasan</CardTitle>
        <div role="group" aria-label="Rentang waktu" className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={cn(
                "min-h-11 min-w-14 rounded-[var(--radius-control)] border px-3 text-helper font-medium",
                period === p
                  ? "border-primary bg-primary-soft text-text"
                  : "border-border-strong text-text-muted hover:bg-surface-2",
              )}
            >
              {p} hari
            </button>
          ))}
        </div>
      </div>
      {data ? (
        <>
          <dl className="grid grid-cols-3 gap-3">
            {(["completed", "partial", "missed"] as const).map((s) => (
              <div key={s} className="flex min-w-0 flex-col items-start gap-2">
                <dt>
                  <StatusChip status={s} />
                </dt>
                <dd className="text-stat font-semibold tabular-nums" data-testid={`count-${s}`}>
                  {data.status_counts[s]}
                </dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-border pt-3">
            <p className="text-text-muted">Tingkat tuntas</p>
            <p className="text-card-title font-semibold" data-testid="completion-rate">
              {formatRate(data.completion_rate)}
            </p>
          </div>
          <CardDescription>Malam berhalangan tidak dihitung.</CardDescription>
        </>
      ) : (
        <Skeleton className="h-28 w-full" />
      )}
    </Card>
  );
}
