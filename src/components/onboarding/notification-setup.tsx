"use client";

import { BellRing } from "lucide-react";
import * as React from "react";
import { errorMessage, useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { PermissionDeniedState } from "@/components/ui/feedback-state";
import { IS_DEMO } from "@/lib/env";

type Permission = "unsupported" | NotificationPermission;

const readPermission = (): Permission =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

/**
 * Turns reminders on: asks the browser for permission, then saves the preference. Web Push delivery arrives
 * with the server (later task), so in demo mode nothing is sent yet and the screen says so.
 */
export function NotificationSetup({ onDone }: { onDone?: () => void }) {
  const { layer, bump } = useData();
  const [permission, setPermission] = React.useState<Permission>("default");
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => setPermission(readPermission()), []);

  async function enable() {
    if (!layer) return;
    setBusy(true);
    setError(null);
    try {
      let p = readPermission();
      if (p === "default") p = await Notification.requestPermission();
      setPermission(p);
      if (p !== "granted") return;
      const prefs = await layer.notifications.getPreferences();
      await layer.notifications.putPreferences({
        ...prefs,
        bedtime: { ...prefs.bedtime, enabled: true },
        tahajud: { enabled: true },
        fajr: { enabled: true },
      });
      setSaved(true);
      bump();
      onDone?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (permission === "unsupported") {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-[var(--radius-control)] bg-info-soft p-3">
          Browser ini belum mendukung notifikasi. Di iPhone, buka aplikasi dari ikon di Layar Utama dulu. Sementara itu,
          pasang alarm di HP sebagai pengingat.
        </p>
      </div>
    );
  }

  if (permission === "denied") {
    return (
      <PermissionDeniedState description="Notifikasi diblokir di browser. Buka pengaturan situs, izinkan notifikasi, lalu muat ulang halaman. Sementara itu, pasang alarm di HP." />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {saved ? (
        <p role="status" className="rounded-[var(--radius-control)] bg-success-soft p-3">
          Pengingat tidur, tahajud, dan Subuh sudah diaktifkan.
          {IS_DEMO ? " Mode demo: belum ada notifikasi yang dikirim." : ""}
        </p>
      ) : (
        <Button loading={busy} onClick={() => void enable()}>
          <BellRing aria-hidden className="size-5" />
          Aktifkan pengingat
        </Button>
      )}
      {error ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3">
          {error}
        </p>
      ) : null}
      <p className="text-helper text-text-muted">
        Pengingat bersifat best effort. Selalu pasang alarm di HP sebagai cadangan.
      </p>
    </div>
  );
}
