"use client";

import { ArrowLeft, Minus, Moon, Plus, Sun } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { errorMessage, useData, useLoad } from "@/components/providers/data-provider";
import { LoadGate } from "@/components/providers/load-gate";
import { applyThemePref, currentTheme } from "@/components/settings/theme-control";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn } from "@/lib/cn";
import { AL_KAHFI, ayahCount, readCount, surahByNumber, type SurahMeta } from "./surahs";
import { loadSurahText, type SurahText } from "./text-source";
import { useKahfiWindow } from "./use-kahfi";

const FONT_MIN = 24;
const FONT_MAX = 44;
const FONT_STEP = 2;

function useSurahText(surah: number) {
  const [state, setState] = React.useState<{ loading: boolean; text: SurahText | null }>({ loading: true, text: null });
  React.useEffect(() => {
    let alive = true;
    loadSurahText(surah).then((text) => alive && setState({ loading: false, text }));
    return () => {
      alive = false;
    };
  }, [surah]);
  return state;
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
  const { loading, text } = useSurahText(meta.number);
  const [dark, setDark] = React.useState(false);
  const [size, setSize] = React.useState(fontSize);
  React.useEffect(() => setSize(fontSize), [fontSize]);
  React.useEffect(() => setDark(currentTheme() === "dark"), []);
  const kahfi = useKahfiWindow();
  const lastRef = React.useRef<HTMLLIElement | null>(null);
  React.useEffect(() => {
    if (text && ayah !== null) lastRef.current?.scrollIntoView({ block: "center" });
    // Restore the position once the text is on screen, not on every bookmark tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  async function save(next: number | null) {
    if (!layer) return;
    await layer.quran.putProgress(meta.number, { ayah: next });
    bump();
  }

  async function resize(delta: number) {
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, size + delta));
    setSize(next);
    await layer?.profile.updatePreferences({ quran_font_size: next });
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
      </div>

      {loading ? null : text ? (
        <>
          {text.isFixture ? (
            <p role="note" className="rounded-[var(--radius-control)] bg-warning-soft p-3">
              {text.attribution}
            </p>
          ) : null}
          <Card as="div" className="p-0">
            <ol className="flex flex-col divide-y divide-border">
              {text.verses.map((v) => {
                const isLast = v.number === ayah;
                return (
                  <li
                    key={v.number}
                    ref={isLast ? lastRef : undefined}
                    data-last-read={isLast || undefined}
                    className={cn("flex flex-col gap-2 p-4", isLast && "bg-primary-soft")}
                  >
                    <p className="arabic text-start leading-[2.2]" lang="ar" dir="rtl" style={{ fontSize: size }}>
                      {v.text}
                    </p>
                    <button
                      type="button"
                      aria-pressed={isLast}
                      aria-label={`Tandai ayat ${v.number} sebagai ayat terakhir`}
                      onClick={() => save(v.number)}
                      className="flex min-h-11 w-fit items-center gap-2 rounded-full border border-border-strong px-3 text-helper font-medium"
                    >
                      Ayat {v.number}
                      {isLast ? <span>· Terakhir dibaca</span> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </Card>
          <p className="text-helper text-text-muted">{text.attribution}</p>
        </>
      ) : (
        <EmptyState
          title="Dataset Al-Qur'an belum diimport"
          description="Teks ayat hanya dari dataset Tanzil yang sudah diverifikasi, dan belum dipasang. Sampai itu selesai, kamu bisa membaca dari mushaf lalu mencatat posisimu di sini."
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
