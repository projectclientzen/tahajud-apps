"use client";

import { LogOut } from "lucide-react";
import * as React from "react";
import { useSignOut } from "@/components/auth/use-logout";
import { useData, useQueueSnapshot } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose } from "@/components/ui/sheet";
import type { QueueItem } from "@/offline";
import { cn } from "@/lib/cn";

const REASON: Record<string, string> = {
  SESSION_LOCKED: "Sesinya sudah ditutup, jadi server tidak menerima catatan ini.",
  VALIDATION_ERROR: "Server tidak menerima catatan ini.",
};

const describe = (it: QueueItem): string => {
  const what =
    it.operation_type === "counter_set_zero"
      ? "Setel ulang hitungan dzikir"
      : it.operation_type === "counter_delta"
        ? `Hitungan dzikir (${(it.payload as { delta: number }).delta > 0 ? "+" : ""}${(it.payload as { delta: number }).delta})`
        : "Centang amalan";
  return `${what}. ${REASON[it.last_error ?? ""] ?? "Server tidak menerima catatan ini."}`;
};

type Step = "closed" | "confirm" | "unsynced" | "confirm-discard";

/**
 * Logout with the PRD §21.4 dialog: if notes have not reached the server, offer to sync first, or to leave
 * and drop them after a second confirmation. Refused notes are listed so nothing disappears quietly.
 */
export function LogoutButton({ className, iconOnly = false }: { className?: string; iconOnly?: boolean }) {
  const signOut = useSignOut();
  const { queue, flushScreens } = useData();
  const snap = useQueueSnapshot();
  const [step, setStep] = React.useState<Step>("closed");
  const [busy, setBusy] = React.useState(false);
  const [rejected, setRejected] = React.useState<QueueItem[]>([]);
  const [message, setMessage] = React.useState<string | null>(null);

  async function start() {
    setBusy(true);
    setMessage(null);
    try {
      flushScreens(); // taps still in a counter screen's buffer go into the queue first
      await new Promise((r) => setTimeout(r, 0));
      if (!queue || (await queue.canLogoutSafely())) {
        setStep("confirm");
        return;
      }
      setRejected(await queue.listRejected());
      setStep("unsynced");
    } finally {
      setBusy(false);
    }
  }

  async function syncFirst() {
    if (!queue) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await queue.flushNow();
      if (res.status === "offline") {
        setMessage("Belum bisa sinkron karena tidak ada sinyal. Coba lagi saat online, atau pilih keluar dan buang.");
        return;
      }
      setRejected(await queue.listRejected());
      if (await queue.canLogoutSafely()) {
        setStep("closed");
        await signOut();
        return;
      }
      setMessage(
        res.retry > 0
          ? "Sebagian catatan belum terkirim. Coba lagi sebentar lagi."
          : "Semua catatan yang bisa terkirim sudah terkirim.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function discardAndLeave() {
    if (!queue) return;
    setBusy(true);
    try {
      await queue.dismissRejected();
      setStep("closed");
      await signOut();
    } finally {
      setBusy(false);
    }
  }

  const waiting = snap.pending;
  const total = snap.pending + snap.rejected;

  // Everything reached the server while the dialog was open: nothing is left to warn about.
  React.useEffect(() => {
    if (step === "unsynced" && total === 0) setStep("confirm");
  }, [step, total]);
  const onlyRefused = waiting === 0 && snap.rejected > 0;

  return (
    <>
      <Button
        variant="ghost"
        size={iconOnly ? "icon" : "md"}
        aria-label={iconOnly ? "Keluar" : undefined}
        onClick={start}
        loading={busy && step === "closed"}
        className={cn(!iconOnly && "justify-start", className)}
      >
        <LogOut aria-hidden className="size-5" />
        {iconOnly ? null : "Keluar"}
      </Button>
      <Sheet
        open={step !== "closed"}
        onOpenChange={(o) => !o && setStep("closed")}
        placement="center"
        title={
          step === "confirm"
            ? "Keluar dari akun?"
            : step === "confirm-discard"
              ? `Buang ${total} catatan?`
              : `Ada ${total} catatan belum tersinkron`
        }
        description={
          step === "confirm"
            ? "Data di perangkat ini dihapus. Catatan ibadahmu tetap aman di akun. Masuk lagi dengan kode email."
            : step === "confirm-discard"
              ? "Catatan ini dihapus dari perangkat dan tidak bisa dikembalikan."
              : onlyRefused
                ? "Server tidak menerima catatan di bawah. Lihat dulu, lalu kamu bisa keluar."
                : "Catatan ini baru ada di perangkat ini. Sinkronkan dulu supaya tidak hilang."
        }
      >
        {step === "confirm" ? (
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await signOut();
                } finally {
                  setBusy(false);
                }
              }}
            >
              Ya, keluar
            </Button>
            <SheetClose asChild>
              <Button variant="ghost">Batal</Button>
            </SheetClose>
          </div>
        ) : step === "confirm-discard" ? (
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button variant="danger" loading={busy} onClick={discardAndLeave}>
              Ya, keluar dan buang
            </Button>
            <Button variant="ghost" onClick={() => setStep("unsynced")}>
              Kembali
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {rejected.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {rejected.slice(0, 5).map((it) => (
                  <li key={it.operation_id} className="rounded-[var(--radius-control)] bg-error-soft p-3">
                    {describe(it)}
                  </li>
                ))}
                {rejected.length > 5 ? (
                  <li className="text-helper text-text-muted">dan {rejected.length - 5} catatan lain</li>
                ) : null}
              </ul>
            ) : null}
            {message ? (
              <p role="status" className="rounded-[var(--radius-control)] bg-info-soft p-3">
                {message}
              </p>
            ) : null}
            <div className="flex flex-col gap-2">
              {onlyRefused ? (
                <Button variant="primary" loading={busy} onClick={discardAndLeave}>
                  Sudah saya lihat, keluar
                </Button>
              ) : (
                <>
                  <Button loading={busy} onClick={syncFirst}>
                    Sinkronkan dulu
                  </Button>
                  <Button variant="secondary" onClick={() => setStep("confirm-discard")}>
                    Keluar dan buang catatan
                  </Button>
                </>
              )}
              <SheetClose asChild>
                <Button variant="ghost">Batal</Button>
              </SheetClose>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
