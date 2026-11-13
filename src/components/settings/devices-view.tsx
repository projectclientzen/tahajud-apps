"use client";

import { Laptop } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { errorCode, errorMessage } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, SessionExpiredState } from "@/components/ui/feedback-state";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PROVISIONAL_AUTH } from "@/domain/config/provisional";
import type { Device } from "@/data";
import { formatRelative } from "./relative-time";

export function DevicesScreen() {
  const { auth } = useAuth();
  const [devices, setDevices] = React.useState<Device[] | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [target, setTarget] = React.useState<Device | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [now, setNow] = React.useState(0);

  const load = React.useCallback(async () => {
    if (!auth) return;
    try {
      setDevices(await auth.listDevices());
      setError(null);
      setNow(Date.now());
    } catch (e) {
      setError(e);
    }
  }, [auth]);
  React.useEffect(() => void load(), [load]);

  async function revoke() {
    if (!auth || !target) return;
    setBusy(true);
    try {
      await auth.revokeDevice(target.id);
      setTarget(null);
      await load();
    } catch (e) {
      setError(e);
      setTarget(null);
    } finally {
      setBusy(false);
    }
  }

  const max = PROVISIONAL_AUTH.maxActiveDevices;
  return (
    <>
      <PageHeader
        title="Perangkat aktif"
        description={`Akunmu bisa aktif di ${max} perangkat. Jika sudah penuh, perangkat lain baru bisa masuk setelah kamu mengeluarkan salah satu perangkat di sini.`}
      />
      {error && !devices ? (
        errorCode(error) === "UNAUTHENTICATED" ? (
          <SessionExpiredState
            action={
              <Link href="/login" className={buttonVariants({ variant: "secondary" })}>
                Masuk
              </Link>
            }
          />
        ) : (
          <ErrorState
            title="Daftar perangkat belum bisa dimuat"
            description={errorMessage(error)}
            action={
              <Button variant="secondary" onClick={load}>
                Coba lagi
              </Button>
            }
          />
        )
      ) : !devices ? (
        <div role="status" aria-label="Memuat" className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <>
          {error ? (
            <p role="alert" className="mb-4 text-error">
              {errorMessage(error)}
            </p>
          ) : null}
          <ul className="flex flex-col gap-3">
            {devices.map((d) => (
              <li key={d.id}>
                <Card as="div" className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Laptop aria-hidden className="size-6 shrink-0" strokeWidth={1.75} />
                    <div className="min-w-0">
                      <p className="font-medium">
                        {d.label}
                        {d.is_current ? (
                          <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-helper">
                            Perangkat ini
                          </span>
                        ) : null}
                      </p>
                      <p className="text-helper text-text-muted">
                        Terakhir aktif: {formatRelative(d.last_seen_at, now)}
                      </p>
                    </div>
                  </div>
                  {d.is_current ? null : (
                    <Button variant="secondary" onClick={() => setTarget(d)} aria-label={`Keluarkan ${d.label}`}>
                      Keluarkan
                    </Button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      <Sheet
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Keluarkan perangkat ini?"
        description={
          target ? `${target.label} harus masuk lagi dengan password. Catatan ibadahmu tidak terhapus.` : undefined
        }
      >
        <Button variant="danger" loading={busy} onClick={revoke}>
          Ya, keluarkan
        </Button>
      </Sheet>
    </>
  );
}
