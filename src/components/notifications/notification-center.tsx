"use client";

import { AlarmClock, BellRing } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { InstallGuide } from "@/components/pwa/install-guide";
import { errorMessage, useData, useLoad } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState, PermissionDeniedState } from "@/components/ui/feedback-state";
import { cn } from "@/lib/cn";
import { ScheduleNote } from "@/components/settings/schedule-note";
import { formatClock, tzLabel } from "@/lib/format-id";
import { detectPlatform, isStandalone } from "@/offline/platform";
import { DEMO_HISTORY } from "./demo-history";
import { pushState, type PushState } from "./push-support";

function readState(): PushState {
  const nav = navigator as Navigator & { standalone?: boolean };
  return pushState({
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    platform: detectPlatform({ userAgent: nav.userAgent, maxTouchPoints: nav.maxTouchPoints, platform: nav.platform }),
    standalone: isStandalone({ matchMedia: (q) => window.matchMedia(q), navigatorStandalone: nav.standalone }),
    permission: "Notification" in window ? Notification.permission : null,
  });
}

function ManualAlarm({ highlight }: { highlight: boolean }) {
  const { data } = useLoad(async (l) => ({ wake: await l.prayer.getWakePlan(), fajr: await l.prayer.getNextFajr() }));
  const wake = data?.wake.wake_at
    ? `${formatClock(data.wake.wake_at, data.fajr.timezone)} ${tzLabel(data.fajr.timezone)}`
    : null;
  return (
    <Card className={highlight ? "flex flex-col gap-3 bg-highlight-soft" : "flex flex-col gap-3"}>
      <div className="flex items-center gap-2">
        <AlarmClock aria-hidden className="size-6" strokeWidth={1.75} />
        <CardTitle>Pasang alarm manual</CardTitle>
      </div>
      <p>
        {wake ? (
          <>
            Jam bangun yang disarankan: <strong data-testid="manual-wake">{wake}</strong>.
          </>
        ) : (
          "Jadwal Subuh belum tersedia. Atur wilayah di Pengaturan untuk melihat jam bangun."
        )}
      </p>
      {data ? <ScheduleNote fajr={data.fajr} /> : null}
      <ol className="list-decimal pl-5 text-text-muted">
        <li>Buka aplikasi Jam di HP.</li>
        <li>Buat alarm di jam bangun tadi, lalu beri nama Tahajud.</li>
        <li>Buat satu alarm cadangan 10 menit setelahnya.</li>
      </ol>
      <p className="text-helper text-text-muted">
        Pengingat dari aplikasi bersifat usaha terbaik. Alarm di perangkat tetap yang paling bisa diandalkan.
      </p>
    </Card>
  );
}

export function NotificationCenter() {
  const { layer } = useData();
  const [state, setState] = React.useState<PushState | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => setState(readState()), []);

  async function ask() {
    try {
      await Notification.requestPermission();
      setState(readState());
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <>
      <PageHeader
        title="Notifikasi"
        actions={
          <Link href="/settings" className={cn(buttonVariants({ variant: "secondary" }), "min-h-11 px-4")}>
            Atur pengingat
          </Link>
        }
      />
      <div className="flex flex-col gap-6">
        {state === "needs_install" ? (
          <>
            <EmptyState
              icon={BellRing}
              title="Pasang aplikasi dulu untuk mengaktifkan pengingat"
              description="Di iPhone dan iPad, notifikasi hanya bisa menyala dari aplikasi yang dipasang di Layar Utama (iOS 16.4 atau lebih baru)."
            />
            <InstallGuide />
          </>
        ) : null}
        {state === "unsupported" ? (
          <EmptyState
            icon={BellRing}
            title="Browser ini belum mendukung notifikasi push"
            description="Kamu tetap bisa beribadah seperti biasa. Pakai alarm di perangkat sebagai pengingat."
          />
        ) : null}
        {state === "denied" ? <PermissionDeniedState /> : null}
        {state === "can_ask" ? (
          <Card className="flex flex-col gap-3">
            <CardTitle>Aktifkan pengingat</CardTitle>
            <p className="text-text-muted">
              Aplikasi mengirim pengingat tidur, tahajud, dan Subuh sesuai pengaturanmu. Browser akan meminta izin
              setelah kamu menekan tombol ini.
            </p>
            <Button className="self-start" onClick={ask}>
              Aktifkan pengingat
            </Button>
            {err ? (
              <p role="alert" className="text-error">
                {err}
              </p>
            ) : null}
          </Card>
        ) : null}
        {state === "granted" ? (
          <Card role="status">
            <p>
              Izin notifikasi sudah diberikan. Pengiriman pengingat aktif setelah layanan notifikasi server tersedia.
            </p>
          </Card>
        ) : null}

        {state ? <ManualAlarm highlight={state === "unsupported" || state === "denied"} /> : null}

        <Card className="flex flex-col gap-3">
          <CardTitle>Riwayat</CardTitle>
          {layer?.mode === "mock" ? (
            <ul className="flex flex-col divide-y divide-border">
              {DEMO_HISTORY.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-3">
                  <span>
                    {h.title}
                    <span className="block text-helper text-text-muted">{h.when}</span>
                  </span>
                  <span className="text-helper text-text-muted">
                    {h.outcome === "sent" ? "Terkirim" : "Kedaluwarsa, tidak dikirim"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-muted">Belum ada riwayat notifikasi.</p>
          )}
        </Card>
      </div>
    </>
  );
}
