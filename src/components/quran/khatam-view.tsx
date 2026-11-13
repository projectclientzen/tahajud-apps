"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { PageSkeleton } from "@/components/providers/load-gate";
import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/feedback-state";
import { ProgressRing } from "@/components/ui/progress-ring";
import { errorCode, errorMessage } from "@/components/providers/data-provider";
import { PRAYER_LABEL, type KhatamView, type Prayer } from "@/domain/khatam";
import { cn } from "@/lib/cn";
import { BrowseLists } from "./browse";
import { NightReadings } from "./surah-list";
import { readHref } from "./read-modes";
import { useKhatam, type KhatamHook } from "./use-khatam";

/** Pages per prayer time, per day and on the last day for a given N (mirrors the plan in src/domain/khatam). */
function planText(n: number): string {
  return `${4 * n} halaman tiap waktu salat, ${20 * n} halaman sehari. Hari ke-30 ditambah sisa ${4 * n} halaman.`;
}

function CountPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: number;
  onChange: (n: number) => void;
  idPrefix: string;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="font-medium">Berapa kali khatam dalam 30 hari?</legend>
      <div className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <label
            key={n}
            htmlFor={`${idPrefix}-${n}`}
            className={cn(
              "flex min-h-12 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border font-semibold tabular-nums has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
              value === n ? "border-primary bg-primary text-on-primary" : "border-border-strong bg-surface text-text",
            )}
          >
            <input
              id={`${idPrefix}-${n}`}
              type="radio"
              name={`${idPrefix}-count`}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="sr-only"
            />
            {n}x
          </label>
        ))}
      </div>
      <p className="text-helper text-text-muted" aria-live="polite">
        {value}x khatam: {planText(value)}
      </p>
    </fieldset>
  );
}

function Setup({ hook, title, intro }: { hook: KhatamHook; title: string; intro: string }) {
  const [n, setN] = React.useState(1);
  const [busy, setBusy] = React.useState(false);
  async function start() {
    setBusy(true);
    try {
      await hook.createTarget(n);
    } catch {
      /* the notice is already set by the hook */
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-card-title font-semibold">{title}</h2>
        <p className="text-text-muted">{intro}</p>
      </div>
      <CountPicker value={n} onChange={setN} idPrefix="setup" />
      <Button onClick={start} disabled={busy} className="w-full sm:w-fit">
        {busy ? "Menyimpan..." : "Mulai target 30 hari"}
      </Button>
    </Card>
  );
}

function Overview({ v }: { v: KhatamView }) {
  const done = v.status === "completed";
  return (
    <Card className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <ProgressRing
        value={v.pagesRead}
        max={v.totalPages}
        label="Progres khatam"
        size={180}
        stroke={14}
        done={done}
        className="shrink-0"
      >
        <span className="flex flex-col items-center">
          <span className="text-[2rem] font-bold leading-none tabular-nums" data-testid="khatam-percent">
            {v.percent}%
          </span>
          <span className="text-helper text-text-muted">terbaca</span>
        </span>
      </ProgressRing>
      <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-3 sm:w-auto sm:flex-1">
        <Stat label="Khatam" value={done ? `${v.khatamCount} dari ${v.khatamCount} selesai` : `ke-${v.khatamNumber} dari ${v.khatamCount}`} />
        <Stat label="Halaman terbaca" value={`${v.pagesRead} dari ${v.totalPages}`} />
        <Stat label="Sisa halaman" value={String(v.pagesLeft)} testId="khatam-left" />
        <Stat label="Sisa hari" value={v.status === "active" ? String(v.daysLeft) : "0"} />
      </dl>
    </Card>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-helper text-text-muted">{label}</dt>
      <dd className="text-card-title font-semibold tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

function Today({ v, hook }: { v: KhatamView; hook: KhatamHook }) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-card-title font-semibold">Bacaan hari ini</h2>
        <p className="text-helper text-text-muted">
          Hari ke-{v.day} dari 30. Centang setelah bacaan waktu itu selesai. Halaman dimulai dari posisi terakhirmu.
        </p>
      </div>
      {v.carriedOver > 0 ? (
        <p className="rounded-[var(--radius-control)] bg-surface-2 px-3 py-2" data-testid="khatam-carried">
          Sisa dari hari sebelumnya: {v.carriedOver} halaman. Boleh dikejar kapan saja, tanpa terburu-buru.
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-border">
        {v.today.map((s) => (
          <li key={s.prayer} className="flex min-h-14 items-center gap-3 py-2">
            <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={s.done}
                onChange={(e) => void hook.setSlot(v.day, s.prayer as Prayer, e.target.checked)}
                className="size-6 shrink-0 accent-[var(--color-primary)]"
              />
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">
                  {PRAYER_LABEL[s.prayer]}
                  <span className="sr-only">, {s.pages} halaman</span>
                </span>
                <span className="text-helper text-text-muted tabular-nums">
                  {s.done
                    ? `${s.pages} halaman, selesai`
                    : s.fromPage !== null
                      ? `${s.pages} halaman, mulai halaman ${s.fromPage}`
                      : `${s.pages} halaman`}
                </span>
              </span>
            </label>
            {!s.done && s.fromPage !== null ? (
              <Link
                href={readHref("halaman", s.fromPage)}
                className={cn(buttonVariants({ variant: "secondary" }), "shrink-0")}
                aria-label={`Baca ${PRAYER_LABEL[s.prayer]} dari halaman ${s.fromPage}`}
              >
                Baca
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ChangeTarget({ v, hook }: { v: KhatamView; hook: KhatamHook }) {
  const [n, setN] = React.useState(v.khatamCount);
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      await hook.changeTarget(n);
      setSaved(true);
    } catch {
      /* notice set by the hook */
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
      <summary className="min-h-11 cursor-pointer font-medium">Ubah target</summary>
      <div className="flex flex-col gap-4 pt-4">
        <p className="text-helper text-text-muted">
          Halaman yang sudah kamu baca tetap tercatat. Hanya jumlah target dan rencana harian yang berubah.
        </p>
        <CountPicker value={n} onChange={setN} idPrefix="change" />
        <Button variant="secondary" onClick={save} disabled={busy || n === v.khatamCount} className="w-full sm:w-fit">
          Simpan target
        </Button>
        {saved ? (
          <p role="status" className="text-text-muted">
            Target diubah menjadi {n}x khatam.
          </p>
        ) : null}
      </div>
    </details>
  );
}

function Summary({ v, hook }: { v: KhatamView; hook: KhatamHook }) {
  const done = v.status === "completed";
  return (
    <>
      <Card className="flex flex-col gap-2" data-testid="khatam-summary">
        <h2 className="text-card-title font-semibold">
          {done ? "Alhamdulillah, targetmu tercapai." : "Periode 30 harimu sudah selesai."}
        </h2>
        <p className="text-text-muted">
          {done
            ? `Kamu membaca ${v.pagesRead} halaman, ${v.khatamCount}x khatam.`
            : `Kamu membaca ${v.pagesRead} dari ${v.totalPages} halaman (${v.percent}%), ${v.completedKhatam}x khatam penuh. Sisa ${v.pagesLeft} halaman tidak hilang. Kamu bisa membuat target baru kapan saja.`}
        </p>
      </Card>
      <Setup hook={hook} title="Buat target baru" intro="Target baru mulai hari ini dan berjalan 30 hari." />
    </>
  );
}

function Notice({ hook }: { hook: KhatamHook }) {
  if (!hook.notice) return null;
  return (
    <p role="alert" className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] bg-surface-2 px-3 py-2">
      <span>{hook.notice}</span>
      <button type="button" onClick={hook.clearNotice} className="min-h-11 shrink-0 px-2 font-medium underline">
        Tutup
      </button>
    </p>
  );
}

export function KhatamSection() {
  const hook = useKhatam();
  if (hook.loading) return <PageSkeleton />;
  if (hook.error && !hook.view && !hook.empty) {
    return errorCode(hook.error) === "OFFLINE" ? (
      <ErrorState title="Belum ada koneksi" description="Target khatam dimuat saat online. Daftar surah dan juz di bawah tetap bisa dibuka." />
    ) : (
      <ErrorState
        title="Target khatam belum bisa dimuat"
        description={errorMessage(hook.error)}
        action={
          <Button variant="secondary" onClick={hook.reload}>
            Coba lagi
          </Button>
        }
      />
    );
  }
  if (hook.empty || !hook.view) {
    return (
      <div className="flex flex-col gap-4">
        <Notice hook={hook} />
        <Setup
          hook={hook}
          title="Mulai target khatam"
          intro="Pilih berapa kali khatam dalam 30 hari. Bacaan dibagi per waktu salat, dan kamu mencentang saat selesai."
        />
      </div>
    );
  }
  const v = hook.view;
  return (
    <div className="flex flex-col gap-4">
      <Notice hook={hook} />
      <Overview v={v} />
      {v.status === "active" ? (
        <>
          {v.currentPage !== null ? (
            <Link href={readHref("halaman", v.currentPage)} className={cn(buttonVariants(), "w-full sm:w-fit")}>
              <BookOpen aria-hidden className="size-5" />
              Lanjut baca dari halaman {v.currentPage}
            </Link>
          ) : null}
          <Today v={v} hook={hook} />
          <ChangeTarget v={v} hook={hook} />
        </>
      ) : (
        <Summary v={v} hook={hook} />
      )}
    </div>
  );
}

export function QuranHome() {
  return (
    <>
      <PageHeader title="Al-Qur'an" description="Target khatam 30 hari dan seluruh mushaf." />
      <div className="flex flex-col gap-8">
        <KhatamSection />
        <div>
          <h2 className="pb-3 text-card-title font-semibold">Seluruh Al-Qur&apos;an</h2>
          <BrowseLists />
        </div>
        <details className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <summary className="min-h-11 cursor-pointer font-medium">Enam bacaan malam</summary>
          <div className="flex flex-col gap-3 pt-4">
            <p className="text-helper text-text-muted">
              Bacaan dari sesi amalan malam. Posisi tersimpan di setiap surah dan tidak dihitung ke target khatam.
            </p>
            <NightReadings />
          </div>
        </details>
      </div>
    </>
  );
}

