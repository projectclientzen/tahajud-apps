"use client";

import { ChevronRight, LockKeyhole } from "lucide-react";
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
              <section aria-labelledby="riwayat-level" className="flex flex-col gap-3 pt-2">
                <div className="flex flex-col gap-1">
                  <h2 id="riwayat-level" className="text-card-title font-semibold">
                    Riwayat level
                  </h2>
                  <p className="text-helper text-text-muted">
                    Level yang sudah kamu capai bisa dibuka lagi, hanya untuk dibaca. Level lain terbuka setelah syaratnya
                    tercapai.
                  </p>
                </div>
                <ul className="flex flex-col gap-2">
                  {d.level_progress.levels.map((lv) =>
                    lv.unlocked ? (
                      <li key={lv.level}>
                        <Link
                          href={`/worship/level/${lv.level}`}
                          className="flex min-h-14 items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 hover:bg-surface-2"
                        >
                          <span className="flex flex-col">
                            <span className="font-medium">
                              Level {lv.level}: {levelTitle(lv.level)}
                            </span>
                            <span className="text-helper text-text-muted">
                              {lv.is_current ? "Sedang berjalan. " : ""}Malam tuntas {lv.completed} dari {lv.required}
                            </span>
                          </span>
                          <ChevronRight aria-hidden className="size-5 shrink-0 text-text-muted" />
                        </Link>
                      </li>
                    ) : (
                      <li key={lv.level}>
                        <div
                          aria-disabled="true"
                          className="flex min-h-14 items-center justify-between gap-3 rounded-[var(--radius-card)] bg-surface-2 px-4 py-3 text-text-muted"
                        >
                          <span className="font-medium">Level {lv.level}</span>
                          <span className="inline-flex items-center gap-1.5 text-helper">
                            <LockKeyhole aria-hidden className="size-4" />
                            Terkunci
                          </span>
                        </div>
                      </li>
                    ),
                  )}
                </ul>
              </section>
            </div>
          );
        }}
      </LoadGate>
    </>
  );
}
