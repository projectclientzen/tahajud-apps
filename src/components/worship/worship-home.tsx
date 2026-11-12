"use client";

import Link from "next/link";
import { LoadGate } from "@/components/providers/load-gate";
import { useLoad } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import { getLevelConfig, nightDhikrTotal, nightRakaatTotal } from "@/domain/content";
import { PROVISIONAL_SETTINGS } from "@/domain/config/provisional";
import { levelTitle } from "@/components/dashboard/content-lookup";

/** Amalan tab: what tonight holds at the user's level, and the way into the session. */
export function WorshipHome() {
  const { data, error, loading, reload } = useLoad((l) => l.report.getDashboard());
  return (
    <>
      <PageHeader title="Amalan malam ini" description="Panduan dan catatan ibadah malammu." />
      <LoadGate data={data} error={error} loading={loading} onRetry={reload}>
        {(d) => {
          const cfg = getLevelConfig(d.level);
          const minutes = PROVISIONAL_SETTINGS.levels[d.level].estimatedDurationMinutes;
          const s = d.current_session;
          const label =
            s?.state === "in_progress"
              ? "Lanjutkan ibadah"
              : s?.state === "completed"
                ? "Lihat sesi malam ini"
                : "Mulai ibadah malam ini";
          return (
            <div className="flex flex-col gap-4">
              <Card className="flex flex-col gap-3">
                <CardTitle>
                  Level {d.level}: {levelTitle(d.level)}
                </CardTitle>
                {s ? <StatusChip status={s.status} className="self-start" /> : null}
                <ul className="flex flex-col gap-1 text-text-muted">
                  <li>{nightRakaatTotal(cfg)} rakaat salat malam</li>
                  <li>{nightDhikrTotal(cfg).toLocaleString("id-ID")} hitungan dzikir malam</li>
                  <li>Perkiraan sekitar {minutes} menit</li>
                </ul>
                <CardDescription>Perkiraan durasi masih sementara sampai disetujui pembimbing.</CardDescription>
              </Card>
              <Link href="/worship/session" className={buttonVariants({ size: "lg", block: true })}>
                {label}
              </Link>
            </div>
          );
        }}
      </LoadGate>
    </>
  );
}
