"use client";

import { ArrowLeft, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { LevelAmalan } from "@/components/levels/level-amalan";
import { levelTitle } from "@/components/dashboard/content-lookup";
import { useLoad } from "@/components/providers/data-provider";
import { LoadGate } from "@/components/providers/load-gate";
import { PageHeader } from "@/components/shell/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback-state";
import { StatusChip } from "@/components/ui/status-chip";
import type { LevelNumber } from "@/domain/config/provisional";
import { formatDateShort } from "@/lib/format-id";

/**
 * Read-only look at a level the user has reached: what it asks for, plus the notes of the nights spent at it.
 * A level that is not reached yet shows a locked state and nothing of its content (no preview).
 * Opening this never changes progress.
 */
export function LevelHistory({ level }: { level: LevelNumber }) {
  const { data, error, loading, reload } = useLoad(async (l) => {
    const [progress, history] = await Promise.all([l.progress.getLevelProgress(), l.report.getSessionHistory()]);
    return { progress, history };
  });
  return (
    <>
      <PageHeader
        title={`Level ${level}: ${levelTitle(level)}`}
        description="Riwayat level. Hanya baca."
        actions={
          <Link
            href="/worship"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-text-muted hover:text-text"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Amalan
          </Link>
        }
      />
      <LoadGate data={data} error={error} loading={loading} onRetry={reload}>
        {(d) => {
          const lv = d.progress.levels.find((x) => x.level === level);
          if (!lv?.unlocked) {
            return (
              <EmptyState
                icon={LockKeyhole}
                title="Level ini belum terbuka"
                description="Isi level ini terbuka setelah syarat level sebelumnya tercapai. Kamu belum bisa melihatnya sekarang."
                action={
                  <Link href="/levels" className={buttonVariants({ variant: "secondary" })}>
                    Lihat perjalanan level
                  </Link>
                }
              />
            );
          }
          const nights = d.history.sessions.filter((s) => s.level === level);
          const count = (st: string) => nights.filter((n) => n.status === st).length;
          return (
            <div className="flex flex-col gap-6">
              <Card className="flex flex-col gap-3" data-testid="level-recap">
                <CardTitle>Rekap catatan level ini</CardTitle>
                <p className="text-text-muted">
                  {lv.is_current ? "Level yang sedang kamu jalani. " : ""}
                  Malam tuntas {lv.completed} dari {lv.required} yang dibutuhkan.
                </p>
                {nights.length === 0 ? (
                  <p className="text-text-muted">Belum ada catatan malam di level ini.</p>
                ) : (
                  <>
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Count label="Tuntas" value={count("completed")} />
                      <Count label="Sebagian" value={count("partial")} />
                      <Count label="Terlewat" value={count("missed")} />
                      <Count label="Berhalangan" value={count("excused")} />
                    </dl>
                    <ul className="flex flex-col divide-y divide-border">
                      {nights.map((n) => (
                        <li key={n.session_key} className="flex min-h-12 items-center justify-between gap-3 py-2">
                          <span>
                            <span className="block font-medium">{formatDateShort(n.session_key)}</span>
                            <span className="text-helper tabular-nums text-text-muted">
                              {n.required_done} dari {n.required_total} amalan wajib
                            </span>
                          </span>
                          <StatusChip status={n.status} />
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Card>

              <section aria-labelledby="isi-amalan" className="flex flex-col gap-3">
                <h2 id="isi-amalan" className="text-card-title font-semibold">
                  Isi amalan
                </h2>
                <Card>
                  <LevelAmalan level={level} phaseHeading="h3" />
                </Card>
                <p className="text-helper text-text-muted">
                  Teks Arab dari konten yang disetujui owner. Syarat sesi tuntas adalah aturan aplikasi, bukan hukum
                  fikih.
                </p>
              </section>
            </div>
          );
        }}
      </LoadGate>
    </>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <dt className="text-helper text-text-muted">{label}</dt>
      <dd className="text-card-title font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
