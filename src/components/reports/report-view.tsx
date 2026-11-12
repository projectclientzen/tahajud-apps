"use client";

import Link from "next/link";
import * as React from "react";
import { activityTitle } from "@/components/dashboard/content-lookup";
import { LoadGate } from "@/components/providers/load-gate";
import { useLoad } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatCard } from "@/components/ui/stat-card";
import { StatusChip } from "@/components/ui/status-chip";
import { SESSION_STATUSES } from "@/domain/content/session-status";
import type { ReportResponse } from "@/data";
import { cn } from "@/lib/cn";
import { formatRate } from "@/lib/format-id";

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

/** Presentational: the same markup the screen shows, fed by any ReportResponse. */
export function ReportBody({ report }: { report: ReportResponse }) {
  const c = report.status_counts;
  const closed = c.completed + c.partial + c.missed + c.excused;
  const stats = report.activity_statistics
    .filter((s) => s.sessions > 0)
    .sort((a, b) => b.times_completed / b.sessions - a.times_completed / a.sessions);
  return (
    <div className="flex flex-col gap-6">
      <StatCard
        label="Tingkat tuntas"
        value={<span data-testid="completion-rate">{formatRate(report.completion_rate)}</span>}
        hint={
          report.completion_rate === null
            ? "Muncul setelah ada sesi yang tuntas, sebagian, atau terlewat."
            : "Tuntas dibagi tuntas, sebagian, dan terlewat. Berhalangan tidak dihitung."
        }
      />
      <Card className="flex flex-col gap-3">
        <CardTitle>Status sesi</CardTitle>
        {closed === 0 ? (
          <p className="text-text-muted">Belum ada data di periode ini.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            {SESSION_STATUSES.filter((s) => s !== "upcoming").map((s) => (
              <li
                key={s}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] bg-surface-2 p-3"
              >
                <StatusChip status={s} />
                <span className="text-stat font-semibold tabular-nums" data-testid={`count-${s}`}>
                  {c[s]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {report.insight ? (
        <Card className="bg-highlight-soft">
          <p role="status">{report.insight.message}</p>
        </Card>
      ) : null}
      <Card className="flex flex-col gap-4">
        <CardTitle>Statistik per amalan</CardTitle>
        {stats.length === 0 ? (
          <p className="text-text-muted">Belum ada data.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {stats.map((s) => (
              <li key={s.id}>
                <ProgressBar
                  label={activityTitle(s.id)}
                  value={s.times_completed}
                  max={s.sessions}
                  valueText={`${s.times_completed} dari ${s.sessions} sesi`}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function ReportScreen() {
  const [period, setPeriod] = React.useState<Period>(7);
  const { data, error, loading, reload } = useLoad((l) => l.report.getReport(period), [period]);
  return (
    <>
      <PageHeader
        title="Laporan"
        description="Ringkasan istiqomahmu. Tanpa skor dan tanpa peringkat."
        actions={
          <Link href="/reports/calendar" className={buttonVariants({ variant: "secondary" })}>
            Kalender
          </Link>
        }
      />
      <fieldset className="mb-6 flex flex-col gap-2">
        <legend className="pb-2 font-semibold">Periode</legend>
        <div className="grid grid-cols-3 gap-2">
          {PERIODS.map((p) => (
            <label
              key={p}
              className={cn(
                "flex min-h-12 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border px-3 font-medium has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
                period === p
                  ? "border-primary bg-primary-soft text-text"
                  : "border-border-strong bg-surface text-text-muted",
              )}
            >
              <input
                type="radio"
                name="period"
                className="sr-only"
                checked={period === p}
                onChange={() => setPeriod(p)}
              />
              {p} hari
            </label>
          ))}
        </div>
      </fieldset>
      <LoadGate data={data} error={error} loading={loading} onRetry={reload}>
        {(r) => <ReportBody report={r} />}
      </LoadGate>
    </>
  );
}
