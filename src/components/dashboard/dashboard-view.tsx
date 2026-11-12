"use client";

import { Bell, CalendarOff, ChartColumn, Settings, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { LoadGate } from "@/components/providers/load-gate";
import { useData, useLoad } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback-state";
import type { Dashboard } from "@/data";
import { cn } from "@/lib/cn";
import { ActivityStats } from "./activity-stats";
import { CalendarCard } from "./calendar-card";
import { ExcuseSheet } from "./excuse-sheet";
import { LevelCard } from "./level-card";
import { ScheduleCard } from "./schedule-card";
import { SetupCards } from "./setup-cards";
import { SummaryCard } from "./summary-card";

/** Header shortcuts (PRD §8.2 A): notifications, full report, settings, profile. */
const HEADER_LINKS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/notifications", label: "Notifikasi", icon: Bell },
  { href: "/reports", label: "Laporan", icon: ChartColumn },
  { href: "/settings", label: "Pengaturan", icon: Settings },
  { href: "/profile", label: "Profil", icon: UserRound },
];

function ctaFor(s: NonNullable<Dashboard["current_session"]>): { label: string; href: string } {
  switch (s.state) {
    case "in_progress":
      return { label: "Lanjutkan ibadah", href: "/worship/session" };
    case "completed":
    case "partial":
      return { label: "Lihat ringkasan sesi", href: "/worship/session#ringkasan" };
    case "excused":
      return { label: "Lihat amalan malam ini", href: "/worship/session" };
    default:
      return { label: "Mulai ibadah malam ini", href: "/worship/session" };
  }
}

function isNewAccount(d: Dashboard) {
  return d.calendar_days.every((x) => x.status === "upcoming" || !x.has_progress) && d.completion_rate === null;
}

function Content({ d, wake }: { d: Dashboard; wake: Awaited<ReturnType<typeof loadWake>> }) {
  const session = d.current_session;
  const cta = session ? ctaFor(session) : { label: "Mulai ibadah malam ini", href: "/worship/session" };
  const excused = session?.status === "excused";
  const excusedDates = d.calendar_days.filter((x) => x.status === "excused").map((x) => x.date);
  const fresh = isNewAccount(d);

  return (
    <div className="flex flex-col gap-6">
      {excused ? (
        <p role="status" className="flex items-start gap-3 rounded-[var(--radius-card)] bg-info-soft p-4">
          <CalendarOff aria-hidden className="mt-0.5 size-5 shrink-0" />
          <span>
            Mode berhalangan aktif untuk malam ini. Progress level tetap aman. Kamu masih bisa mencatat dzikir.
          </span>
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <Link href={cta.href} className={buttonVariants({ size: "lg", block: true })}>
          {cta.label}
        </Link>
        {session ? (
          <p className="text-helper text-text-muted" data-testid="required-progress">
            Syarat sesi tuntas di aplikasi: {session.required_done} dari {session.required_total}.
          </p>
        ) : null}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ScheduleCard prayer={d.prayer_time} wake={wake} />
        <LevelCard progress={d.level_progress} />
      </div>

      {fresh ? (
        <EmptyState
          title="Belum ada catatan"
          description="Catatan pertamamu muncul di sini setelah sesi malam pertama. Tidak ada yang terlewat sebelum kamu mulai."
        />
      ) : (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <SummaryCard />
            {d.insight ? (
              <Card as="div" className="flex flex-col justify-center gap-2 bg-primary-soft">
                <p className="font-semibold">Catatan untukmu</p>
                <p data-testid="insight">{d.insight.message}</p>
              </Card>
            ) : null}
          </div>
          <CalendarCard days={d.calendar_days} />
          <ActivityStats stats={d.activity_statistics} />
        </>
      )}

      <SetupCards cards={d.setup_cards} />

      {session ? (
        <ExcuseSheet
          sessionKey={session.session_key}
          excusedDates={excusedDates}
          trigger={
            <Button variant="ghost" className="self-start">
              Tandai berhalangan
            </Button>
          }
        />
      ) : null}
    </div>
  );
}

async function loadWake(layer: NonNullable<ReturnType<typeof useData>["layer"]>) {
  try {
    return await layer.prayer.getWakePlan();
  } catch {
    return null;
  }
}

/** Dashboard Istiqomah (PRD §8). All numbers come from the data layer. */
export function DashboardView() {
  const { data, error, loading, reload } = useLoad(async (l) => ({
    dashboard: await l.report.getDashboard(),
    wake: await loadWake(l),
  }));
  return (
    <>
      <PageHeader
        title="Dashboard Istiqomah"
        description="Assalamu'alaikum, selamat melanjutkan perjalanan istiqomahmu."
        actions={
          <>
            {HEADER_LINKS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                aria-label={label}
                className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-11")}
              >
                <Icon aria-hidden className="size-5" />
              </Link>
            ))}
          </>
        }
      />
      <LoadGate data={data} error={error} loading={loading} onRetry={reload}>
        {(v) => <Content d={v.dashboard} wake={v.wake} />}
      </LoadGate>
    </>
  );
}
