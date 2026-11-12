"use client";

import * as React from "react";
import { useData, useDataOptional } from "@/components/providers/data-provider";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Sheet, SheetClose } from "@/components/ui/sheet";
import { IS_DEMO } from "@/lib/env";
import type { QueueItem } from "@/offline";
import { useSignOut } from "./use-sign-out";

const REASON: Record<string, string> = {
  SESSION_LOCKED: "Sesi malam itu sudah ditutup.",
  VALIDATION_ERROR: "Catatan ini tidak bisa diterima server.",
  ACTIVITY_NOT_FOUND: "Amalan ini sudah tidak ada di sesi.",
  INVALID_DELTA: "Jumlah hitungan tidak valid.",
};

interface Check {
  pending: number;
  rejected: QueueItem[];
}

/** Logout with a safety check: unsent notes block a quiet sign-out until the user decides (DZIKIR-06). */
export function LogoutButton(props: Omit<ButtonProps, "onClick">) {
  // Pages outside a signed-in tree (the component gallery) have nothing to sign out of.
  return useDataOptional() ? <LogoutDialog {...props} /> : null;
}

function LogoutDialog({ children = "Keluar", ...buttonProps }: Omit<ButtonProps, "onClick">) {
  const { queue, flushAll } = useData();
  const signOut = useSignOut();
  const [open, setOpen] = React.useState(false);
  const [check, setCheck] = React.useState<Check | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const recheck = React.useCallback(async () => {
    if (!queue) return;
    const [pending, rejected] = await Promise.all([queue.pendingCount(), queue.listRejected()]);
    setCheck({ pending, rejected });
  }, [queue]);

  React.useEffect(() => {
    if (!open) return;
    setCheck(null);
    setNote(null);
    // Taps still waiting in a counter screen go into the queue first, so they are counted.
    flushAll();
    void new Promise((r) => setTimeout(r, 50)).then(recheck);
  }, [open, flushAll, recheck]);

  async function syncFirst() {
    if (!queue) return;
    setBusy(true);
    setNote(null);
    const r = await queue.flushNow();
    await recheck();
    setNote(r.status === "offline" ? "Belum ada sinyal. Catatan tetap tersimpan di perangkat." : null);
    setBusy(false);
  }

  async function leave() {
    setBusy(true);
    await signOut();
  }

  const loading = check === null;
  const hasPending = (check?.pending ?? 0) > 0;
  const hasRejected = (check?.rejected.length ?? 0) > 0;

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Keluar dari perangkat ini?"
      description={
        IS_DEMO
          ? "Data di perangkat ini dihapus. Di mode demo, data demo ikut terhapus."
          : "Data di perangkat ini dihapus. Catatan yang sudah tersinkron tetap aman di server."
      }
      trigger={
        <Button variant="ghost" {...buttonProps}>
          {children}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {loading ? <p role="status">Memeriksa catatanmu.</p> : null}

        {hasPending ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-warning-soft p-4 text-text"
          >
            <p className="font-semibold" data-testid="logout-warning">
              {check!.pending} catatan belum tersinkron
            </p>
            <p>Kalau keluar sekarang, catatan itu hilang dari perangkat ini dan tidak pernah sampai ke server.</p>
            <Button variant="secondary" onClick={syncFirst} loading={busy}>
              Sinkronkan dulu
            </Button>
            {note ? <p role="status">{note}</p> : null}
          </div>
        ) : null}

        {hasRejected ? (
          <div role="alert" className="flex flex-col gap-3 rounded-[var(--radius-control)] bg-info-soft p-4 text-text">
            <p className="font-semibold">{check!.rejected.length} catatan ditolak server</p>
            <ul className="list-disc pl-5">
              {check!.rejected.map((r) => (
                <li key={r.operation_id}>{REASON[r.last_error ?? ""] ?? "Server menolak catatan ini."}</li>
              ))}
            </ul>
            <Button
              variant="secondary"
              onClick={async () => {
                await queue?.dismissRejected();
                await recheck();
              }}
            >
              Mengerti
            </Button>
          </div>
        ) : null}

        {!loading ? (
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button
              variant={hasPending ? "danger" : "primary"}
              onClick={leave}
              disabled={hasRejected}
              loading={busy && !hasPending}
            >
              {hasPending ? "Tetap keluar dan hapus catatan" : "Keluar"}
            </Button>
            <SheetClose asChild>
              <Button variant="ghost">Batal</Button>
            </SheetClose>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
