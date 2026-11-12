"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { GateSkeleton } from "@/components/auth/gate";
import { useSignOut } from "@/components/auth/use-logout";
import { useAuth } from "@/components/providers/auth-provider";
import { useData } from "@/components/providers/data-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { AccessDeniedState, PurchasePendingState, SessionExpiredState } from "@/components/ui/feedback-state";
import type { Access } from "@/data";
import { accessScreenFor, GUARD_PATHS, type AccessScreen } from "@/domain/auth/route-guard";
import { PURCHASE_URL } from "@/lib/env";
import { CsWhatsappButton } from "./cs-whatsapp-button";

/**
 * /access-status (PRD §6.4): why the user is not inside the app. The screen is chosen from what the auth layer
 * and the server say, never from the URL, so nobody can open a state that is not theirs.
 */
export function AccessStatusView() {
  const router = useRouter();
  const { ready, session } = useAuth();
  const { layer } = useData();
  const signOut = useSignOut();
  const [access, setAccess] = React.useState<Access | null>(null);
  const [checked, setChecked] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const [stillPending, setStillPending] = React.useState(false);
  const authed = session?.authenticated === true;

  const load = React.useCallback(async () => {
    if (!layer) return;
    setChecking(true);
    try {
      setAccess(await layer.access.getAccess());
    } catch {
      setAccess(null);
    } finally {
      setChecked(true);
      setChecking(false);
    }
  }, [layer]);

  React.useEffect(() => {
    if (authed && layer) void load();
  }, [authed, layer, load]);

  const screen: AccessScreen | null = !ready
    ? null
    : accessScreenFor(
        authed
          ? { authenticated: true, accessStatus: access?.access_status }
          : { authenticated: false, signedOutReason: session?.reason ?? "none" },
      );

  // Not a visitor of this page: signed out for no special reason goes to login, active access goes on to the app.
  React.useEffect(() => {
    if (!ready) return;
    if (!authed && screen === null) router.replace(GUARD_PATHS.login);
    if (authed && checked && access?.access_status === "active") router.replace(GUARD_PATHS.dashboard);
  }, [ready, authed, screen, checked, access, router]);

  if (!ready || (authed && !checked) || screen === null) return <GateSkeleton />;

  if (screen === "session_expired") {
    const revoked = session?.reason === "revoked";
    return (
      <div className="flex flex-col gap-4">
        <SessionExpiredState
          description={
            revoked
              ? "Perangkat ini dikeluarkan dari akunmu. Masuk lagi dengan kode email untuk melanjutkan."
              : "Masuk lagi dengan email yang sama. Catatan ibadahmu tetap tersimpan."
          }
        />
        <Link href="/login" className={buttonVariants({ size: "lg", block: true })}>
          Masuk lagi
        </Link>
      </div>
    );
  }

  const leave = (
    <Button variant="ghost" block onClick={() => void signOut()}>
      Pakai email lain
    </Button>
  );

  if (screen === "purchase_pending") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="sr-only">Status akses</h1>
        <PurchasePendingState />
        {stillPending ? (
          <p role="status" className="rounded-[var(--radius-control)] bg-info-soft p-3">
            Belum terverifikasi. Coba cek lagi nanti.
          </p>
        ) : null}
        <Button
          size="lg"
          block
          loading={checking}
          onClick={async () => {
            setStillPending(false);
            await load();
            setStillPending(true);
          }}
        >
          Cek lagi
        </Button>
        <CsWhatsappButton message="Halo CS Tahajud Tracker, pembelian saya belum terverifikasi." />
        {leave}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">Status akses</h1>
      <AccessDeniedState
        title="Belum ada akses aktif untuk email ini"
        description={
          access?.access_status === "suspended"
            ? "Aksesmu sedang ditangguhkan. Hubungi CS supaya bisa dicek bersama."
            : "Cek apakah emailnya sama dengan email checkout di Scalev. Kalau belum membeli, kamu bisa membeli akses di bawah."
        }
      />
      {PURCHASE_URL ? (
        <a
          href={PURCHASE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ size: "lg", block: true })}
        >
          Beli akses di Scalev
          <span className="sr-only"> (buka di tab baru)</span>
        </a>
      ) : null}
      <CsWhatsappButton message="Halo CS Tahajud Tracker, saya sudah membeli tapi akses belum aktif." />
      {leave}
    </div>
  );
}
