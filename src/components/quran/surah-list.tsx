"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { LoadGate } from "@/components/providers/load-gate";
import { useLoad } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ayahCount, readCount, SURAHS, AL_KAHFI } from "./surahs";
import { useKahfiWindow } from "./use-kahfi";

export function SurahList() {
  const { data, error, loading, reload } = useLoad((l) => l.quran.getProgress());
  const kahfi = useKahfiWindow();
  return (
    <>
      <PageHeader title="Al-Qur'an" description="Enam bacaan malam. Posisi bacaanmu tersimpan di setiap surah." />
      <LoadGate data={data} error={error} loading={loading} onRetry={reload}>
        {(progress) => (
          <ul className="grid gap-3 md:grid-cols-2">
            {SURAHS.map((s) => {
              const p = progress.find((x) => x.surah === s.number);
              const done = readCount(s, p?.ayah ?? null);
              return (
                <li key={s.number}>
                  <Card as="div" className="p-0">
                    <Link
                      href={`/quran/${s.number}`}
                      className="flex min-h-14 flex-col gap-3 rounded-[var(--radius-card)] p-5 hover:bg-surface-2"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-card-title font-semibold">{s.name}</span>
                          {s.number === AL_KAHFI && kahfi.active ? (
                            <span className="rounded-full bg-highlight-soft px-2.5 py-0.5 text-helper font-medium">
                              Bacaan Jumat{kahfi.estimate ? " (perkiraan)" : ""}
                            </span>
                          ) : null}
                        </span>
                        <ChevronRight aria-hidden className="size-5 shrink-0 text-text-muted" />
                      </span>
                      <ProgressBar
                        label={`Surah ke-${s.number}`}
                        value={done}
                        max={ayahCount(s)}
                        valueText={done === 0 ? `${ayahCount(s)} ayat` : `${done} dari ${ayahCount(s)} ayat`}
                      />
                    </Link>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </LoadGate>
    </>
  );
}
