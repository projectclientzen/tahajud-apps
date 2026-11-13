"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useData, useLoad } from "@/components/providers/data-provider";
import { LoadGate } from "@/components/providers/load-gate";
import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/feedback-state";
import { Skeleton } from "@/components/ui/skeleton";
import { fullQuran, mushaf, QURAN_ATTRIBUTION, type PageSegment } from "@/data/quran";
import type { AyahRange } from "@/domain/quran";
import { cn } from "@/lib/cn";
import { modeLimit, readHref, type ReadMode } from "./read-modes";

const FONT_MIN = 24;
const FONT_MAX = 44;
const FONT_STEP = 2;

export function rangesFor(mode: ReadMode, n: number): AyahRange[] {
  if (mode === "surah") {
    const r = mushaf.surahRange(n);
    return r ? [r] : [];
  }
  return mode === "juz" ? mushaf.juzRanges(n) : mushaf.pageRanges(n);
}

function titleFor(mode: ReadMode, n: number): string {
  if (mode === "surah") return mushaf.surah(n)?.name ?? `Surah ${n}`;
  return mode === "juz" ? `Juz ${n}` : `Halaman ${n}`;
}

function useSegments(mode: ReadMode, n: number) {
  const [state, setState] = React.useState<{ loading: boolean; segments: PageSegment[] | null }>({
    loading: true,
    segments: null,
  });
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    setState({ loading: true, segments: null });
    void fullQuran.getSegments(rangesFor(mode, n)).then((segments) => alive && setState({ loading: false, segments }));
    return () => {
      alive = false;
    };
  }, [mode, n, attempt]);
  return { ...state, retry: () => setAttempt((a) => a + 1) };
}

function Ayahs({ seg, size, showPages }: { seg: PageSegment; size: number; showPages: boolean }) {
  let lastPage = 0;
  return (
    <Card as="div" className="overflow-hidden p-0">
      {seg.starts ? (
        <div className="border-b border-border px-4 py-4 text-center">
          <h2 className="text-card-title font-semibold">{seg.surahName}</h2>
          {seg.opening ? (
            <p className="arabic mt-3 leading-[2.2]" lang="ar" dir="rtl" style={{ fontSize: size }} data-testid="basmalah">
              {seg.opening}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="border-b border-border px-4 py-3 text-helper text-text-muted">
          {seg.surahName}, lanjutan
        </div>
      )}
      <ol className="flex flex-col divide-y divide-border">
        {seg.verses.map((v) => {
          const page = showPages ? (mushaf.pageOf(seg.surah, v.number) ?? 0) : 0;
          const marker = showPages && page !== lastPage;
          lastPage = page;
          return (
            <li key={v.number} className="flex flex-col">
              {marker ? (
                <Link
                  href={readHref("halaman", page)}
                  className="px-4 py-2 text-helper font-medium text-text-muted hover:bg-surface-2"
                >
                  Halaman {page}
                </Link>
              ) : null}
              <div className="flex items-start gap-3 px-4 py-4">
                <span
                  aria-label={`Ayat ${v.number}`}
                  className="grid size-9 shrink-0 place-items-center rounded-full border border-border-strong text-helper font-semibold tabular-nums"
                >
                  {v.number}
                </span>
                <p
                  className="arabic min-w-0 flex-1 text-start leading-[2.2]"
                  lang="ar"
                  dir="rtl"
                  style={{ fontSize: size }}
                  data-ayah={`${seg.surah}:${v.number}`}
                >
                  {v.text}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Body({
  mode,
  n,
  fontSize,
  footer,
}: {
  mode: ReadMode;
  n: number;
  fontSize: number;
  footer?: React.ReactNode;
}) {
  const { layer } = useData();
  const { loading, segments, retry } = useSegments(mode, n);
  const [size, setSize] = React.useState(fontSize);
  React.useEffect(() => setSize(fontSize), [fontSize]);

  async function resize(delta: number) {
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, size + delta));
    if (next === size) return;
    setSize(next);
    try {
      await layer?.profile.updatePreferences({ quran_font_size: next });
    } catch {
      setSize(size);
    }
  }

  const limit = modeLimit(mode);
  const showPages = mode !== "halaman";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tampilan bacaan">
        <Button variant="secondary" size="icon" aria-label="Perkecil huruf" onClick={() => resize(-FONT_STEP)} disabled={size <= FONT_MIN}>
          <Minus aria-hidden className="size-5" />
        </Button>
        <span data-testid="reader-font" className="min-w-14 text-center tabular-nums">
          {size} px
        </span>
        <Button variant="secondary" size="icon" aria-label="Perbesar huruf" onClick={() => resize(FONT_STEP)} disabled={size >= FONT_MAX}>
          <Plus aria-hidden className="size-5" />
        </Button>
      </div>

      {loading ? (
        <div role="status" aria-label="Memuat teks ayat" className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : segments ? (
        <>
          {segments.map((seg) => (
            <Ayahs key={`${seg.surah}-${seg.verses[0]?.number}`} seg={seg} size={size} showPages={showPages} />
          ))}
          {footer}
          <p className="text-helper text-text-muted" data-testid="quran-attribution">
            Teks Al-Qur&apos;an: Tanzil Project (
            <a href={QURAN_ATTRIBUTION.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {QURAN_ATTRIBUTION.sourceName}
            </a>
            ), lisensi{" "}
            <a href={QURAN_ATTRIBUTION.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {QURAN_ATTRIBUTION.licenseName}
            </a>
            . Halaman mengikuti Mushaf Madinah (metadata Tanzil).
          </p>
        </>
      ) : (
        <ErrorState
          title="Teks ayat belum bisa dimuat"
          description="Teks hanya diambil dari dataset Tanzil yang sudah diverifikasi. Coba muat lagi saat koneksi kembali."
          action={
            <Button variant="secondary" onClick={retry}>
              Coba lagi
            </Button>
          }
        />
      )}

      {mode !== "surah" ? (
        <nav aria-label={mode === "juz" ? "Pindah juz" : "Pindah halaman"} className="flex items-center justify-between gap-3">
          <Link
            aria-disabled={n <= 1}
            tabIndex={n <= 1 ? -1 : undefined}
            href={readHref(mode, Math.max(1, n - 1))}
            className={cn(buttonVariants({ variant: "secondary" }), n <= 1 && "pointer-events-none opacity-50")}
          >
            <ChevronLeft aria-hidden className="size-5" />
            Sebelumnya
          </Link>
          <Link
            aria-disabled={n >= limit}
            tabIndex={n >= limit ? -1 : undefined}
            href={readHref(mode, Math.min(limit, n + 1))}
            className={cn(buttonVariants({ variant: "secondary" }), n >= limit && "pointer-events-none opacity-50")}
          >
            Berikutnya
            <ChevronRight aria-hidden className="size-5" />
          </Link>
        </nav>
      ) : null}
    </div>
  );
}

/** Reader for any surah, juz or Madinah page. `footer` is where the khatam actions plug in. */
export function FullReader({ mode, n, footer }: { mode: ReadMode; n: number; footer?: React.ReactNode }) {
  const { data, error, loading, reload } = useLoad(async (l) => (await l.profile.getProfile()).quran_font_size, []);
  const sub =
    mode === "surah"
      ? `${mushaf.surah(n)?.ayahs ?? 0} ayat, halaman ${mushaf.surahFirstPage(n) ?? "-"}`
      : mode === "juz"
        ? `Mulai halaman ${mushaf.juzFirstPage(n) ?? "-"}`
        : `${mushaf.pageRanges(n).reduce((c, r) => c + (r.to - r.from + 1), 0)} ayat`;
  return (
    <>
      <PageHeader
        title={titleFor(mode, n)}
        description={sub}
        actions={
          <Link
            href="/quran"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-text-muted hover:text-text"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Al-Qur&apos;an
          </Link>
        }
      />
      <LoadGate data={data} error={error} loading={loading} onRetry={reload}>
        {(fontSize) => <Body mode={mode} n={n} fontSize={fontSize} footer={footer} />}
      </LoadGate>
    </>
  );
}
