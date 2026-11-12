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
import { LOGIN_EMAIL_KEY } from "./seed-user";

const SCENARIO_LABEL: Record<AuthScenarioName, string> = {
  logged_out: "Belum masuk",
  logged_in: "Sudah masuk (demo)",
  purchase_pending: "Pembelian belum terverifikasi",
  no_active_access: "Email tanpa akses",
  session_expired: "Sesi kedaluwarsa",
};

/**
 * Demo-only tools on the sign-in screens: read the OTP that a real server would email, change the
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
  const [otp, setOtp] = React.useState<string | null>(null);
  const [scenario, setScenario] = React.useState<AuthScenarioName>("logged_out");
  const [info, setInfo] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    try {
      setEmail(session?.user?.email ?? sessionStorage.getItem(LOGIN_EMAIL_KEY) ?? "");
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
      description="Hanya ada saat mode demo. Menggantikan email, WhatsApp, dan server."
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
          <Button variant="secondary" onClick={async () => setOtp(await dev.peekOtp(email))}>
            Tampilkan kode OTP
          </Button>
          <p data-testid="dev-otp" className="text-stat font-semibold tabular-nums">
            {otp ?? "Belum ada kode"}
          </p>
          <p className="text-helper text-text-muted">Akses demo aktif: demo@ngajigaes.test</p>
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
