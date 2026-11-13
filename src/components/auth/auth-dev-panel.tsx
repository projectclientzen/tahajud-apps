"use client";

import { Wrench } from "lucide-react";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useDataOptional } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { AUTH_SCENARIOS, type AuthScenarioName } from "@/data";
import { DEV_ROUTES_ENABLED, IS_DEMO } from "@/lib/env";
import { fieldClass } from "./auth-shell";
import { DEMO_EMAILS, DEMO_PASSWORD, DEMO_PHONES } from "@/data/mock/fixtures/auth";

const SCENARIO_LABEL: Record<AuthScenarioName, string> = {
  logged_out: "Belum masuk",
  logged_in: "Sudah masuk (demo)",
  purchase_pending: "Pembelian belum terverifikasi",
  no_active_access: "Email tanpa akses",
  session_expired: "Sesi kedaluwarsa",
  device_limit: "Belum masuk, akun sudah di 3 perangkat",
};

/**
 * Demo-only tools on the sign-in screens: show the demo accounts, make a reset link like CS would, change the
 * entitlement, expire the session. Hidden outside mock mode.
 */
export function AuthDevPanel() {
  return IS_DEMO && DEV_ROUTES_ENABLED ? <AuthDevPanelInner /> : null;
}

function AuthDevPanelInner() {
  const { dev, refresh, session } = useAuth();
  const data = useDataOptional();
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [resetLink, setResetLink] = React.useState<string | null>(null);
  const [scenario, setScenario] = React.useState<AuthScenarioName>("logged_out");
  const [info, setInfo] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    try {
      setEmail(session?.user?.email ?? DEMO_EMAILS.active);
    } catch {
      /* storage blocked */
    }
  }, [open, session]);

  if (!dev) return null;

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Alat demo masuk"
      description="Hanya ada saat mode demo. Menggantikan CS, order Scalev, dan server."
      trigger={
        <button
          type="button"
          aria-label="Buka alat demo masuk"
          className="fixed bottom-4 left-3 z-20 grid size-11 place-items-center rounded-full border border-border-strong bg-surface text-text-muted shadow-sm hover:bg-surface-2"
        >
          <Wrench aria-hidden className="size-5" />
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="authdev-email" className="font-semibold">
            Email
          </label>
          <input
            id="authdev-email"
            type="email"
            className={fieldClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button
            variant="secondary"
            onClick={async () => {
              const t = await dev.issueResetToken(email);
              setResetLink(t ? `/reset#t=${t}` : null);
              setInfo(t ? "Tautan reset demo dibuat" : "Email ini belum punya akun demo");
            }}
          >
            Buat tautan reset demo
          </Button>
          {resetLink ? (
            <a data-testid="dev-reset-link" href={resetLink} className="break-all underline">
              {resetLink}
            </a>
          ) : null}
          <div className="rounded-[var(--radius-control)] bg-surface-2 p-3 text-helper text-text-muted">
            <p className="font-semibold text-text">Data demo (bukan data asli)</p>
            <p>Akun demo: {DEMO_EMAILS.active}</p>
            <p>
              Password demo: <span data-testid="dev-demo-password">{DEMO_PASSWORD}</span>
            </p>
            <p>HP order demo: {DEMO_PHONES.active}</p>
            <p>Order lunas tanpa akun (untuk aktivasi): {DEMO_EMAILS.newBuyer}, HP {DEMO_PHONES.newBuyer}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-semibold">Hak akses email ini</span>
          <div className="grid grid-cols-3 gap-2">
            {(["active", "pending_verification", "none"] as const).map((s) => (
              <Button
                key={s}
                variant="secondary"
                onClick={async () => {
                  await dev.setEntitlement(email, s);
                  if (data?.dev && s === "active") await data.dev.loadScenario("onboarding_pending");
                  data?.bump();
                  setInfo(`Akses ${email}: ${s}`);
                }}
              >
                {s === "active" ? "Aktif" : s === "pending_verification" ? "Menunggu" : "Tidak ada"}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="authdev-scenario" className="font-semibold">
            Skenario masuk
          </label>
          <select
            id="authdev-scenario"
            className={fieldClass}
            value={scenario}
            onChange={(e) => setScenario(e.target.value as AuthScenarioName)}
          >
            {AUTH_SCENARIOS.map((s) => (
              <option key={s} value={s}>
                {SCENARIO_LABEL[s]}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            onClick={async () => {
              await dev.loadScenario(scenario);
              await refresh();
              setInfo(`Skenario ${SCENARIO_LABEL[scenario]} dimuat`);
            }}
          >
            Muat skenario
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await dev.advance(31 * 86_400_000);
              await refresh();
              setInfo("Jam maju 31 hari");
            }}
          >
            Majukan 31 hari
          </Button>
        </div>
        {info ? (
          <p role="status" className="text-helper text-text-muted">
            {info}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
