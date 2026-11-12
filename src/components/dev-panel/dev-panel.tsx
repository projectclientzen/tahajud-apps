"use client";

import { Wrench } from "lucide-react";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useData, useNow } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { SCENARIOS, type ScenarioName } from "@/data";
import { formatClock, formatDateShort } from "@/lib/format-id";
import { DEV_ROUTES_ENABLED, IS_DEMO } from "@/lib/env";

const SCENARIO_LABEL: Record<ScenarioName, string> = {
  new_account: "Akun baru",
  five_nights_completed: "Lima malam tuntas",
  level2_active: "Level 2 aktif",
  offline: "Offline",
  stale_schedule: "Jadwal tersimpan (basi)",
  purchase_pending: "Pembelian belum terverifikasi",
  manual_schedule: "Jadwal manual",
  no_active_access: "Tidak ada akses aktif",
  onboarding_pending: "Belum onboarding",
};

const fieldClass =
  "min-h-12 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-body";

/** Mock-only tools: scenarios, time travel, offline, schedule provider down. Hidden outside demo mode. */
export function DevPanel() {
  return IS_DEMO && DEV_ROUTES_ENABLED ? <DevPanelInner /> : null;
}

function DevPanelInner() {
  const { dev, bump, requests, resetRequests } = useData();
  const auth = useAuth();
  const now = useNow();
  const [open, setOpen] = React.useState(false);
  const [scenario, setScenario] = React.useState<ScenarioName>("new_account");
  const [flags, setFlags] = React.useState({ offline: false, providerDown: false });
  const [stamp, setStamp] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open || !dev) return;
    void dev.snapshot().then((s) => {
      setFlags({ offline: s.offline, providerDown: s.providerDown });
      setScenario(s.scenario);
    });
  }, [open, dev]);

  if (!dev) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      bump();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title="Alat demo"
      description="Hanya ada saat mode demo. Mengubah data tiruan di perangkat ini."
      trigger={
        <button
          type="button"
          aria-label="Buka alat demo"
          className="fixed bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom)+0.75rem)] left-3 z-20 grid size-11 place-items-center rounded-full border border-border-strong bg-surface text-text-muted shadow-sm hover:bg-surface-2 lg:bottom-4 lg:left-[calc(var(--sidebar-width)+1rem)]"
        >
          <Wrench aria-hidden className="size-5" />
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-helper text-text-muted" data-testid="dev-now">
          Jam demo:{" "}
          {now
            ? `${formatDateShort(now.toISOString().slice(0, 10))} ${formatClock(now.toISOString(), "Asia/Jakarta")} WIB`
            : "memuat"}
        </p>

        <div className="flex flex-col gap-2">
          <label htmlFor="dev-scenario" className="font-semibold">
            Skenario
          </label>
          <select
            id="dev-scenario"
            className={fieldClass}
            value={scenario}
            onChange={(e) => setScenario(e.target.value as ScenarioName)}
          >
            {SCENARIOS.map((s) => (
              <option key={s} value={s}>
                {SCENARIO_LABEL[s]}
              </option>
            ))}
          </select>
          <Button variant="secondary" disabled={busy} onClick={() => run(() => dev.loadScenario(scenario))}>
            Muat skenario
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <span className="font-semibold">Jam</span>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => run(() => dev.advance(3_600_000))}>
              +1 jam
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => run(() => dev.advance(86_400_000))}>
              +1 hari
            </Button>
          </div>
          <label htmlFor="dev-stamp" className="text-helper text-text-muted">
            Atur jam (WIB)
          </label>
          <input
            id="dev-stamp"
            type="datetime-local"
            className={fieldClass}
            value={stamp}
            onChange={(e) => setStamp(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              disabled={busy || stamp === ""}
              onClick={() => run(() => dev.setNow(`${stamp}:00+07:00`))}
            >
              Terapkan jam
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => run(() => dev.setNow(null))}>
              Ikuti jam asli
            </Button>
          </div>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend className="pb-1 font-semibold">Gangguan</legend>
          <label className="flex min-h-12 items-center gap-3">
            <input
              type="checkbox"
              className="size-5 accent-[var(--primary)]"
              checked={flags.offline}
              onChange={(e) => {
                const v = e.target.checked;
                setFlags((f) => ({ ...f, offline: v }));
                void run(() => dev.setOffline(v));
              }}
            />
            Simulasi offline
          </label>
          <label className="flex min-h-12 items-center gap-3">
            <input
              type="checkbox"
              className="size-5 accent-[var(--primary)]"
              checked={flags.providerDown}
              onChange={(e) => {
                const v = e.target.checked;
                setFlags((f) => ({ ...f, providerDown: v }));
                void run(() => dev.setProviderDown(v));
              }}
            />
            Penyedia jadwal mati
          </label>
        </fieldset>

        <div className="flex items-center justify-between gap-3">
          <p data-testid="dev-requests">Request counter: {requests}</p>
          <Button variant="ghost" onClick={resetRequests}>
            Nol-kan
          </Button>
        </div>

        {auth.dev ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              await auth.dev!.advance(31 * 86_400_000);
              await auth.refresh();
            }}
          >
            Majukan sesi login 31 hari
          </Button>
        ) : null}

        <Button
          variant="danger"
          disabled={busy}
          onClick={() => run(() => dev.reset()).then(() => window.location.reload())}
        >
          Reset data demo
        </Button>
      </div>
    </Sheet>
  );
}
