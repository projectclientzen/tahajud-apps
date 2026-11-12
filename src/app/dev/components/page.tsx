import amalan from "@content/amalan.v1.json";
import { CalendarCheck, Flame, Moon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/shell/page-header";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/feedback-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import { StatusChip } from "@/components/ui/status-chip";
import { SESSION_STATUSES } from "@/domain/content/session-status";
import { DEV_ROUTES_ENABLED } from "@/lib/env";
import { LoadingButtonDemo, SheetDemo } from "./gallery-demos";

export const metadata: Metadata = { title: "Komponen", robots: { index: false } };

const SWATCHES = [
  ["bg", "Latar"],
  ["surface", "Permukaan"],
  ["surface-2", "Permukaan 2"],
  ["primary", "Utama"],
  ["accent", "Sage (dekorasi)"],
  ["highlight", "Sand"],
  ["success", "Sukses"],
  ["warning", "Peringatan"],
  ["error", "Galat"],
  ["info", "Info"],
] as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>{title}</CardTitle>
      {children}
    </Card>
  );
}

export default function ComponentGallery() {
  if (!DEV_ROUTES_ENABLED) notFound();
  const istighfar = amalan.dhikr.istighfar;

  return (
    <AppShell>
      <PageHeader title="Komponen" description="Galeri design system S1. Hanya untuk pengembangan." />
      <div className="grid grid-cols-1 gap-4">
        <Section title="Tampilan">
          <ThemeToggle />
        </Section>

        <Section title="Warna">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {SWATCHES.map(([token, name]) => (
              <li key={token} className="flex flex-col gap-1.5">
                <span
                  className="h-12 rounded-[var(--radius-control)] border border-border"
                  style={{ background: `var(--${token})` }}
                />
                <span className="text-helper">{name}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Tipografi">
          <p className="text-page-title font-bold">Judul halaman 26px</p>
          <p className="text-card-title font-semibold">Judul kartu 18px</p>
          <p>Teks isi 16px. Catatan ibadahmu hanya bisa kamu lihat sendiri.</p>
          <p className="text-helper text-text-muted">Teks bantu 13px</p>
          <figure className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-surface-2 p-4">
            <p lang="ar" className="arabic text-dhikr">
              {istighfar.arabic_text}
            </p>
            <figcaption className="text-helper text-text-muted">
              {istighfar.title}, dari content/amalan.v1.json
            </figcaption>
          </figure>
        </Section>

        <Section title="Tombol">
          <div className="flex flex-wrap gap-3">
            <Button>Mulai ibadah malam ini</Button>
            <Button variant="secondary">Lihat ringkasan</Button>
            <Button variant="ghost">Nanti saja</Button>
            <Button variant="danger">Hapus catatan</Button>
            <Button disabled>Belum tersedia</Button>
            <LoadingButtonDemo />
          </div>
        </Section>

        <Section title="Status sesi">
          <div className="flex flex-wrap gap-2">
            {SESSION_STATUSES.map((s) => (
              <StatusChip key={s} status={s} />
            ))}
          </div>
        </Section>

        <Section title="Progress">
          <ProgressBar label="Level 1 Fondasi" value={3} max={7} valueText="3 dari 7 malam tuntas" />
          <div className="flex justify-center">
            <ProgressRing label="Istighfar" value={64} max={100}>
              <span className="text-stat font-semibold tabular-nums">64</span>
              <span className="text-helper text-text-muted">dari 100</span>
            </ProgressRing>
          </div>
        </Section>

        <Section title="Kartu statistik">
          <CardDescription>Angka di bawah contoh tampilan, bukan data pengguna.</CardDescription>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Malam tuntas" value="12" icon={<CalendarCheck aria-hidden className="size-4" />} />
            <StatCard label="Sebagian" value="3" icon={<Moon aria-hidden className="size-4" />} />
            <StatCard label="Tingkat tuntas" value="71%" hint="30 hari terakhir" icon={<Flame aria-hidden className="size-4" />} />
          </div>
        </Section>

        <Section title="State">
          <EmptyState title="Belum ada catatan" description="Catatan pertamamu muncul di sini setelah sesi malam ini." />
          <ErrorState
            title="Jadwal belum bisa dimuat"
            description="Kami pakai jadwal tersimpan dulu. Coba muat ulang saat sinyal stabil."
            action={<Button variant="secondary">Muat ulang</Button>}
          />
          <div className="flex flex-col gap-2" aria-label="Contoh skeleton">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </div>
        </Section>

        <Section title="Sheet">
          <SheetDemo />
        </Section>
      </div>
    </AppShell>
  );
}
