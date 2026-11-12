"use client";

import { LockKeyhole, Trophy } from "lucide-react";
import { LoadGate } from "@/components/providers/load-gate";
import { useLoad } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { getLevelConfig, nightDhikrTotal, nightRakaatTotal } from "@/domain/content";
import { PROVISIONAL_SETTINGS } from "@/domain/config/provisional";
import type { LevelProgressResponse } from "@/data";
import { formatDateLong } from "@/lib/format-id";
import { cn } from "@/lib/cn";
import { levelTitle } from "@/components/dashboard/content-lookup";

type Level = LevelProgressResponse["levels"][number];

function stateText(l: Level, prev: Level | undefined): string {
  if (l.is_current) return "Level yang sedang kamu jalani";
  if (l.unlocked) return l.completed >= l.required ? "Syarat level ini sudah tercapai" : "Sudah terbuka";
  return `Terbuka setelah ${prev?.required ?? 0} malam tuntas di Level ${l.level - 1}`;
}

function LevelCard({ l, prev }: { l: Level; prev: Level | undefined }) {
  const cfg = getLevelConfig(l.level);
  const minutes = PROVISIONAL_SETTINGS.levels[l.level].estimatedDurationMinutes;
  return (
    <li>
      <Card
        className={cn(
          "flex flex-col gap-3",
          l.is_current && "border-2 border-primary bg-primary-soft/40",
          !l.unlocked && "bg-surface-2",
        )}
        aria-label={`Level ${l.level}`}
        data-testid={`level-${l.level}`}
      >
        <div className="flex items-start justify-between gap-3">
          <CardTitle>
            Level {l.level}: {levelTitle(l.level)}
          </CardTitle>
          <span className="inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-helper font-medium">
            {l.unlocked ? null : <LockKeyhole aria-hidden className="size-4" />}
            {l.unlocked ? (l.is_current ? "Aktif" : "Terbuka") : "Terkunci"}
          </span>
        </div>
        <p className="text-text-muted">{stateText(l, prev)}.</p>
        <ProgressBar
          label="Malam tuntas"
          value={Math.min(l.completed, l.required)}
          max={l.required}
          valueText={`${l.completed} dari ${l.required}`}
        />
        {l.unlocked && l.effective_from_session_key && l.level > 1 ? (
          <p>Berlaku mulai sesi {formatDateLong(l.effective_from_session_key)}.</p>
        ) : null}
        <ul className="flex flex-col gap-0.5 text-text-muted">
          <li>{nightRakaatTotal(cfg)} rakaat salat malam</li>
          <li>{nightDhikrTotal(cfg).toLocaleString("id-ID")} hitungan dzikir malam</li>
          <li>Perkiraan sekitar {minutes} menit</li>
        </ul>
      </Card>
    </li>
  );
}

/** Level journey (PRD §10): three levels, locked state, effective-from, Level 3 milestone. */
export function LevelsView() {
  const { data, error, loading, reload } = useLoad((l) => l.progress.getLevelProgress());
  return (
    <>
      <PageHeader title="Perjalanan level" description="Naik satu langkah setiap kali syarat malam tuntas tercapai." />
      <LoadGate data={data} error={error} loading={loading} onRetry={reload}>
        {(p) => (
          <div className="flex flex-col gap-4">
            <ol className="flex flex-col gap-4">
              {p.levels.map((l, i) => (
                <LevelCard key={l.level} l={l} prev={p.levels[i - 1]} />
              ))}
            </ol>
            <Card className="flex flex-col gap-2" aria-label="Milestone">
              <div className="flex items-center gap-2">
                <Trophy aria-hidden className="size-5" />
                <CardTitle>Istikamah Journey Completed</CardTitle>
              </div>
              <p data-testid="milestone">
                {p.journey_completed
                  ? "Kamu sudah menuntaskan perjalanan tiga level. Kamu tetap di Level 3 dan pencatatan terus berlanjut."
                  : "Milestone terbuka setelah target Level 3 tercapai. Tidak ada Level 4, pencatatan tetap berlanjut."}
              </p>
            </Card>
            <CardDescription>
              Level yang sudah terbuka tidak terkunci lagi, walau ada koreksi atau malam terlewat. Target level masih
              sementara sampai disetujui pembimbing.
            </CardDescription>
          </div>
        )}
      </LoadGate>
    </>
  );
}
