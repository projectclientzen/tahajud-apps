"use client";

import { ArrowLeft, ArrowDownToLine, Minus, Moon, Plus, Sun } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { errorMessage, useData, useLoad } from "@/components/providers/data-provider";
import { LoadGate } from "@/components/providers/load-gate";
import { applyThemePref, currentTheme } from "@/components/settings/theme-control";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/feedback-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { quranText, type SurahText } from "@/data/quran";
import { cn } from "@/lib/cn";
import { AL_KAHFI, ayahCount, readCount, surahByNumber, type SurahMeta } from "./surahs";
import { useKahfiWindow } from "./use-kahfi";

const FONT_MIN = 24;
const FONT_MAX = 44;
const FONT_STEP = 2;

function useSurahText(surah: number) {
  const [state, setState] = React.useState<{ loading: boolean; text: SurahText | null }>({ loading: true, text: null });
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    setState((s) => (s.loading ? s : { loading: true, text: null }));
    void quranText.getSurah(surah).then((text) => alive && setState({ loading: false, text }));
    return () => {
      alive = false;
    };
  }, [surah, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

interface PanelProps {
  meta: SurahMeta;
  ayah: number | null;
  onSave: (ayah: number | null) => Promise<void>;
  /** Without text the user types the position they reached in a printed mushaf. */
  manual: boolean;
}

function ProgressPanel({ meta, ayah, onSave, manual }: PanelProps) {
  const [value, setValue] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const done = readCount(meta, ayah);
  const total = ayahCount(meta);

  async function run(next: number | null, ok: string) {
    try {
      await onSave(next);
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (!Number.isInteger(n) || n < meta.first || n > meta.last) {
      setMsg({ ok: false, text: `Isi nomor ayat ${meta.first} sampai ${meta.last}.` });
      return;
    }
    void run(n, `Ayat terakhir dicatat: ${n}.`);
  }

  return (
    <Card className="flex flex-col gap-4">
      <ProgressBar
        label="Progres bacaan"
        value={done}
        max={total}
        valueText={ayah === null ? "Belum mulai" : `Ayat ${ayah} dari ${meta.last}`}
      />
      {manual ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="ayah-input" className="font-medium">
            Ayat terakhir dibaca
          </label>
          <div className="flex gap-2">
            <input
              id="ayah-input"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`${meta.first} sampai ${meta.last}`}
              className="min-h-12 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3"
            />
            <Button type="submit" variant="secondary">
              Simpan
            </Button>
          </div>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => run(meta.last, "Bacaan ditandai selesai.")}>
          Tandai selesai
        </Button>
        {ayah !== null ? (
          <Button variant="ghost" onClick={() => run(null, "Progres bacaan dikosongkan.")}>
            Mulai dari awal
          </Button>
        ) : null}
      </div>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={cn(msg.ok ? "text-text-muted" : "text-error")}>
          {msg.text}
        </p>
      ) : null}
    </Card>
  );
}

function ReaderBody({ meta, ayah, fontSize }: { meta: SurahMeta; ayah: number | null; fontSize: number }) {
  const { layer, bump } = useData();
  const { loading, text, retry } = useSurahText(meta.number);
  const [dark, setDark] = React.useState(false);
  const [size, setSize] = React.useState(fontSize);
  React.useEffect(() => setSize(fontSize), [fontSize]);
  React.useEffect(() => setDark(currentTheme() === "dark"), []);
  const kahfi = useKahfiWindow();
  const lastRef = React.useRef<HTMLLIElement | null>(null);
  const restored = React.useRef(false);
  React.useEffect(() => {
    // Restore the position once, when the text first appears. Not on every bookmark tap.
    if (text && ayah !== null && !restored.current) {
      restored.current = true;
      lastRef.current?.scrollIntoView({ block: "center" });
    }
  }, [text, ayah]);

  async function save(next: number | null) {
    if (!layer) return;
    await layer.quran.putProgress(meta.number, { ayah: next });
    bump();
  }

  // The size on screen only changes once it is saved, so what the reader shows is what a reload brings back.
  // Taps queue up, so two quick taps add two steps.
  const sizeRef = React.useRef(fontSize);
  const resizing = React.useRef<Promise<void>>(Promise.resolve());
  React.useEffect(() => {
    sizeRef.current = fontSize;
  }, [fontSize]);

  function resize(delta: number): Promise<void> {
    resizing.current = resizing.current.then(async () => {
      if (!layer) return;
      const next = Math.min(FONT_MAX, Math.max(FONT_MIN, sizeRef.current + delta));
      if (next === sizeRef.current) return;
      try {
        await layer.profile.updatePreferences({ quran_font_size: next });
        sizeRef.current = next;
        setSize(next);
      } catch {
        /* not saved: keep the size on screen as it was */
      }
    });
    return resizing.current;
  }

  function toggleNight() {
    const next = dark ? "light" : "dark";
    applyThemePref(next);
    setDark(!dark);
    void layer?.profile.updatePreferences({ theme_pref: next });
  }

  return (
    <div className="flex flex-col gap-4">
      {meta.number === AL_KAHFI && kahfi.active ? (
        <p className="w-fit rounded-full bg-highlight-soft px-3 py-1 text-helper font-medium">
          Bacaan Jumat{kahfi.estimate ? " (perkiraan)" : ""}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tampilan bacaan">
        <Button
          variant="secondary"
          size="icon"
          aria-label="Perkecil huruf"
          onClick={() => resize(-FONT_STEP)}
          disabled={size <= FONT_MIN}
        >
          <Minus aria-hidden className="size-5" />
        </Button>
        <span data-testid="reader-font" className="min-w-14 text-center tabular-nums">
          {size} px
        </span>
        <Button
          variant="secondary"
          size="icon"
          aria-label="Perbesar huruf"
          onClick={() => resize(FONT_STEP)}
          disabled={size >= FONT_MAX}
        >
          <Plus aria-hidden className="size-5" />
        </Button>
        <Button variant="secondary" aria-pressed={dark} onClick={toggleNight}>
          {dark ? <Sun aria-hidden className="size-5" /> : <Moon aria-hidden className="size-5" />}
          {dark ? "Mode terang" : "Mode malam"}
        </Button>
        {text && ayah !== null ? (
          <Button
            variant="ghost"
            onClick={() => lastRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })}
          >
            <ArrowDownToLine aria-hidden className="size-5" />
            Ke ayat {ayah}
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div role="status" aria-label="Memuat teks ayat" className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : text ? (
        <>
          <Card as="div" className="overflow-hidden p-0">
            {text.opening ? (
              <p
                data-testid="basmalah"
                className="arabic border-b border-border px-4 py-5 text-center leading-[2.2]"
                lang="ar"
                dir="rtl"
                style={{ fontSize: size }}
              >
                {text.opening}
              </p>
            ) : null}
            <ol className="flex flex-col divide-y divide-border">
              {text.verses.map((v) => {
                const isLast = v.number === ayah;
                return (
                  <li
                    key={v.number}
                    ref={isLast ? lastRef : undefined}
                    data-last-read={isLast || undefined}
                    className={cn("flex items-start gap-3 px-4 py-4", isLast && "bg-primary-soft")}
                  >
                    <div className="flex w-12 shrink-0 flex-col items-center gap-1 pt-1">
                      <button
                        type="button"
                        aria-pressed={isLast}
                        aria-label={`Tandai ayat ${v.number} sebagai ayat terakhir`}
                        onClick={() => save(v.number)}
                        className={cn(
                          "flex size-11 items-center justify-center rounded-full border text-helper font-semibold tabular-nums",
                          isLast ? "border-primary bg-primary text-on-primary" : "border-border-strong text-text",
                        )}
                      >
                        {v.number}
                      </button>
                      {isLast ? <span className="text-center text-helper leading-tight">Terakhir dibaca</span> : null}
                    </div>
                    <p
                      className="arabic min-w-0 flex-1 text-start leading-[2.2]"
                      lang="ar"
                      dir="rtl"
                      style={{ fontSize: size }}
                      data-ayah={v.number}
                    >
                      {v.text}
                    </p>
                  </li>
                );
              })}
            </ol>
          </Card>
          <p className="text-helper text-text-muted" data-testid="quran-attribution">
            Teks Al-Qur&apos;an: Tanzil Project (
            <a
              href={text.attribution.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {text.attribution.sourceName}
            </a>
            ), lisensi{" "}
            <a
              href={text.attribution.licenseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {text.attribution.licenseName}
            </a>
            .
          </p>
        </>
      ) : (
        <ErrorState
          title="Teks ayat belum bisa dimuat"
          description="Teks hanya diambil dari dataset Tanzil yang sudah diverifikasi. Coba muat lagi. Sementara itu kamu bisa membaca dari mushaf dan mencatat posisimu di bawah."
          action={
            <Button variant="secondary" onClick={retry}>
              Coba lagi
            </Button>
          }
        />
      )}

      <ProgressPanel meta={meta} ayah={ayah} onSave={save} manual={!loading && !text} />
    </div>
  );
}

export function Reader({ surah }: { surah: number }) {
  const meta = surahByNumber(surah)!;
  const { data, error, loading, reload } = useLoad(
    async (l) => {
      const [progress, profile] = await Promise.all([l.quran.getProgress(), l.profile.getProfile()]);
      return { ayah: progress.find((p) => p.surah === surah)?.ayah ?? null, fontSize: profile.quran_font_size };
    },
    [surah],
  );
  return (
    <>
      <PageHeader
        title={meta.name}
        description={meta.number === 65 ? "At-Talaq ayat 2 sampai 3." : `${ayahCount(meta)} ayat`}
        actions={
          <Link
            href="/quran"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-text-muted hover:text-text"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Daftar surah
          </Link>
        }
      />
      <LoadGate data={data} error={error} loading={loading} onRetry={reload}>
        {(d) => <ReaderBody meta={meta} ayah={d.ayah} fontSize={d.fontSize} />}
      </LoadGate>
    </>
  );
}
