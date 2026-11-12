"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { ApiError, type DeviceLimitResponse } from "@/data";
import { describeDevice } from "@/lib/device-label";
import { cn } from "@/lib/cn";
import { clearPendingEmail } from "./pending-email";

const when = (iso: string) =>
  new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );

/**
 * 4th device (PRD §24.1). The code was right, so the user may remove ONE device and continue, or cancel.
 * Nothing is removed unless they choose it.
 */
export function DeviceLimitPanel({ limit }: { limit: DeviceLimitResponse }) {
  const router = useRouter();
  const { auth, refresh } = useAuth();
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ text: string; expired: boolean } | null>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);

  // The screen replaced the code form: move focus to the new heading so a screen reader announces it.
  React.useEffect(() => heading.current?.focus(), []);

  async function proceed() {
    if (!auth || !chosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      await auth.completePendingLogin(limit.pending_token, chosen, describeDevice());
      clearPendingEmail();
      await refresh();
      router.replace("/dashboard");
    } catch (e) {
      const expired = e instanceof ApiError && e.code === "PENDING_LOGIN_INVALID";
      setError({
        text: expired
          ? "Waktu untuk melanjutkan sudah habis. Minta kode baru untuk masuk lagi."
          : "Belum berhasil. Coba lagi.",
        expired,
      });
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    clearPendingEmail();
    router.replace("/login");
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 ref={heading} className="text-page-title font-bold" tabIndex={-1}>
          Akunmu sudah aktif di {limit.max_devices} perangkat (maksimal)
        </h1>
        <p className="text-text-muted">
          Pilih satu perangkat untuk dikeluarkan. Setelah itu kamu langsung masuk di perangkat ini. Atau batal, dan
          tidak ada yang berubah.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 font-semibold">Perangkat yang dikeluarkan</legend>
        {limit.devices.map((d) => (
          <label
            key={d.id}
            className={cn(
              "flex min-h-14 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border px-4 py-2",
              "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
              chosen === d.id ? "border-primary bg-primary-soft" : "border-border-strong bg-surface",
            )}
          >
            <input
              type="radio"
              name="device"
              value={d.id}
              checked={chosen === d.id}
              onChange={() => setChosen(d.id)}
              className="size-5 accent-[var(--primary)]"
            />
            <span className="flex flex-col">
              <span className="font-semibold">{d.label}</span>
              <span className="text-helper text-text-muted">Terakhir aktif {when(d.last_seen_at)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {error ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-text">
          {error.text}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {error?.expired ? null : (
          <Button size="lg" block disabled={!chosen} loading={busy} onClick={proceed}>
            Keluarkan perangkat ini dan lanjut masuk
          </Button>
        )}
        <Button variant="ghost" block onClick={cancel}>
          {error?.expired ? "Kembali ke halaman masuk" : "Batal"}
        </Button>
      </div>
    </div>
  );
}
