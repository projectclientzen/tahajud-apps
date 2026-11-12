"use client";

import { Clock, MapPin } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { useNow } from "@/components/providers/data-provider";
import { ScheduleNote } from "@/components/settings/schedule-note";
import type { PrayerTime, WakePlan } from "@/data";
import { formatClock, formatDateLong, formatDuration, tzLabel } from "@/lib/format-id";

/** Section B: next Fajr, suggested wake time, countdown that never goes negative, schedule source. */
export function ScheduleCard({ prayer, wake }: { prayer: PrayerTime; wake: WakePlan | null }) {
  const now = useNow();

  if (!prayer.available || !prayer.fajr_at) {
    return (
      <Card className="flex flex-col gap-2">
        <CardTitle>Jadwal Subuh</CardTitle>
        <p className="text-text-muted">Jadwal Subuh belum bisa dimuat. Kamu tetap bisa mencatat ibadah malam ini.</p>
      </Card>
    );
  }

  const ms = now ? new Date(prayer.fajr_at).getTime() - now.getTime() : null;
  const tz = prayer.timezone;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <CardTitle>Subuh berikutnya</CardTitle>
        <p className="flex items-center gap-1.5 text-text-muted">
          <MapPin aria-hidden className="size-4" />
          {prayer.region_name ?? "Jadwal manual"}
        </p>
      </div>
      <div>
        <p className="text-stat font-semibold tabular-nums">
          {formatClock(prayer.fajr_at, tz)} <span className="text-card-title font-medium">{tzLabel(tz)}</span>
        </p>
        <p className="text-text-muted">{formatDateLong(prayer.local_date)}</p>
      </div>
      <p className="flex items-center gap-2 font-medium" data-testid="fajr-countdown">
        <Clock aria-hidden className="size-5 text-text-muted" />
        {ms === null ? "Menghitung" : ms <= 0 ? "Waktu Subuh telah masuk" : `Subuh dalam ${formatDuration(ms)}`}
      </p>
      {wake?.wake_at ? (
        <p>
          Mulai tahajud sekitar {formatClock(wake.wake_at, tz)} {tzLabel(tz)}.
        </p>
      ) : null}
      {wake?.sleep_warning ? (
        <p role="note" className="rounded-[var(--radius-control)] bg-warning-soft p-3 text-warning">
          {wake.sleep_warning}
        </p>
      ) : null}
      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <ScheduleNote fajr={prayer} className="flex flex-col gap-0.5 text-helper text-text-muted" />
        {prayer.cache_status === "cached" ? (
          <CardDescription>Memakai jadwal tersimpan karena sumber belum bisa dihubungi.</CardDescription>
        ) : null}
        {prayer.fetched_at ? (
          <CardDescription>
            Terakhir sinkron {formatClock(prayer.fetched_at, tz)} {tzLabel(tz)}.
          </CardDescription>
        ) : null}
      </div>
    </Card>
  );
}
