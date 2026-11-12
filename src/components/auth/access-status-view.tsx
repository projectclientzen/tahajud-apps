"use client";

import * as React from "react";
import { LoadGate } from "@/components/providers/load-gate";
import { useLoad } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { AccessDeniedState, PurchasePendingState } from "@/components/ui/feedback-state";
import { CS_WHATSAPP_URL, SCALEV_URL } from "./auth-shell";
import { LogoutButton } from "./logout-button";

function Links() {
  return (
    <div className="flex flex-col items-start gap-1">
      {SCALEV_URL ? (
        <a href={SCALEV_URL} className="min-h-11 py-2 font-semibold underline">
          Beli di Scalev
        </a>
      ) : null}
      {CS_WHATSAPP_URL ? (
        <a href={CS_WHATSAPP_URL} className="min-h-11 py-2 font-semibold underline">
          Hubungi CS lewat WhatsApp
        </a>
      ) : (
        <p className="text-helper text-text-muted">Nomor WhatsApp CS menyusul.</p>
      )}
    </div>
  );
}

/** /access-status: purchase pending, or no active access for this email (PRD §5.2, §6.4). */
export function AccessStatusView() {
  const { data, error, loading, reload } = useLoad((l) => l.access.getAccess());
  return (
    <div className="flex flex-col gap-6">
      <LoadGate data={data} error={error} loading={loading} onRetry={reload}>
        {(a) =>
          a.access_status === "awaiting_order_verification" ? (
            <PurchasePendingState
              action={
                <Button variant="secondary" onClick={reload}>
                  Cek lagi
                </Button>
              }
            />
          ) : (
            <AccessDeniedState
              title="Belum ada akses aktif untuk email ini"
              description="Pastikan kamu masuk dengan email yang dipakai saat checkout. Kalau belum membeli, beli dulu lewat Scalev."
              action={
                <Button variant="secondary" onClick={reload}>
                  Cek lagi
                </Button>
              }
            />
          )
        }
      </LoadGate>
      <Links />
      <LogoutButton variant="secondary" className="self-start">
        Ganti email
      </LogoutButton>
    </div>
  );
}
