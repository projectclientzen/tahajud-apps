"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { fieldClass } from "@/components/auth/auth-shell";
import { errorMessage, useData, useLoad } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import type { PrayerTime } from "@/data";
import { formatClock, formatDateLong, tzLabel } from "@/lib/format-id";
import { cn } from "@/lib/cn";
import { requestPersistentStorage } from "@/offline";

type Step = "welcome" | "region" | "confirm";
const STEPS: Step[] = ["welcome", "region", "confirm"];

const ZONES = [
  ["Asia/Jakarta", "WIB (Asia/Jakarta)"],
  ["Asia/Makassar", "WITA (Asia/Makassar)"],
  ["Asia/Jayapura", "WIT (Asia/Jayapura)"],
  ["Asia/Riyadh", "Arab Saudi (Asia/Riyadh)"],
  ["Asia/Kuala_Lumpur", "Malaysia (Asia/Kuala_Lumpur)"],
  ["Asia/Singapore", "Singapura (Asia/Singapore)"],
  ["Europe/London", "Inggris (Europe/London)"],
] as const;

/** Minimum path (PRD §6.2): welcome, region or manual schedule, confirm Fajr. Everything else is a card on the dashboard. */
export function OnboardingFlow() {
  const { layer } = useData();
  const router = useRouter();
  const regions = useLoad((l) => l.prayer.listRegions());
  const [step, setStep] = React.useState<Step>("welcome");
  const [mode, setMode] = React.useState<"region" | "manual">("region");
  const [regionId, setRegionId] = React.useState("");
  const [timezone, setTimezone] = React.useState("Asia/Jakarta");
  const [fajr, setFajr] = React.useState("04:30");
  const [prayer, setPrayer] = React.useState<PrayerTime | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function saveLocation() {
    if (!layer) return;
    setBusy(true);
    setError(null);
    try {
      const p = await layer.profile.setLocation(
        mode === "region" ? { mode: "region", region_id: regionId } : { mode: "manual", timezone, fajr_time: fajr },
      );
      setPrayer(p);
      setStep("confirm");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!layer) return;
    setBusy(true);
    setError(null);
    try {
      await layer.profile.completeOnboarding();
      void requestPersistentStorage();
      router.replace("/dashboard");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const canContinue = mode === "region" ? regionId !== "" : /^\d{2}:\d{2}$/.test(fajr) && timezone !== "";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div aria-hidden className="flex gap-1.5">
          {STEPS.map((x, i) => (
            <span
              key={x}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                i <= STEPS.indexOf(step) ? "bg-primary" : "bg-border-strong/35",
              )}
            />
          ))}
        </div>
        <p className="text-helper text-text-muted" aria-live="polite" data-testid="onboarding-step">
          Langkah {STEPS.indexOf(step) + 1} dari {STEPS.length}
        </p>
      </div>

      {step === "welcome" ? (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-page-title font-bold">Selamat datang</h1>
            <p className="text-text-muted">
              Dua langkah singkat: pilih wilayah, lalu cek jadwal Subuh. Pengingat dan panduan pasang aplikasi bisa
              diatur belakangan dari beranda.
            </p>
          </div>
          <Button size="lg" block onClick={() => setStep("region")}>
            Mulai
          </Button>
        </>
      ) : null}

      {step === "region" ? (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-page-title font-bold">Wilayahmu</h1>
            <p className="text-text-muted">Jadwal Subuh mengikuti wilayah. Tidak ketemu? Atur jam Subuh sendiri.</p>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Cara menentukan jadwal</legend>
            <label className="flex min-h-14 items-center gap-3 rounded-[var(--radius-control)] border border-border px-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <input
                type="radio"
                name="mode"
                className="size-5 accent-[var(--primary)]"
                checked={mode === "region"}
                onChange={() => setMode("region")}
              />
              Pilih wilayah
            </label>
            <label className="flex min-h-14 items-center gap-3 rounded-[var(--radius-control)] border border-border px-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <input
                type="radio"
                name="mode"
                className="size-5 accent-[var(--primary)]"
                checked={mode === "manual"}
                onChange={() => setMode("manual")}
              />
              Atur jadwal manual
            </label>
          </fieldset>

          {mode === "region" ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="pb-1 font-semibold">Kota (daftar contoh)</legend>
              {(regions.data ?? []).map((r) => (
                <label
                  key={r.id}
                  className="flex min-h-14 items-center gap-3 rounded-[var(--radius-control)] border border-border px-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
                >
                  <input
                    type="radio"
                    name="region"
                    className="size-5 accent-[var(--primary)]"
                    checked={regionId === r.id}
                    onChange={() => setRegionId(r.id)}
                  />
                  {r.name}
                </label>
              ))}
            </fieldset>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="ob-tz" className="font-semibold">
                  Zona waktu
                </label>
                <select
                  id="ob-tz"
                  className={fieldClass}
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {ZONES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="ob-fajr" className="font-semibold">
                  Jam Subuh
                </label>
                <input
                  id="ob-fajr"
                  type="time"
                  className={fieldClass}
                  value={fajr}
                  onChange={(e) => setFajr(e.target.value)}
                />
              </div>
            </div>
          )}

          {error ? (
            <p role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Button size="lg" block onClick={saveLocation} loading={busy} disabled={!canContinue}>
              Lanjut
            </Button>
            <Button variant="ghost" onClick={() => setStep("welcome")}>
              Kembali
            </Button>
          </div>
        </>
      ) : null}

      {step === "confirm" && prayer ? (
        <>
          <div className="flex flex-col gap-2">
            <h1 className="text-page-title font-bold">Jadwal Subuh</h1>
            <p className="text-text-muted">Cek dulu. Jadwal bisa diubah nanti.</p>
          </div>
          {prayer.available && prayer.fajr_at ? (
            <div className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-5">
              <p className="text-helper text-text-muted">{prayer.region_name ?? "Jadwal manual"}</p>
              <p className="text-stat font-semibold tabular-nums" data-testid="confirm-fajr">
                {formatClock(prayer.fajr_at, prayer.timezone)} {tzLabel(prayer.timezone)}
              </p>
              <p>{formatDateLong(prayer.local_date)}</p>
              <p className="text-helper text-text-muted">
                {prayer.label ?? ""}
                {prayer.demo_note ? `. ${prayer.demo_note}` : ""}
              </p>
            </div>
          ) : (
            <p role="alert" className="rounded-[var(--radius-control)] bg-warning-soft p-3">
              Jadwal Subuh belum tersedia untuk pilihan ini. Coba atur jadwal manual.
            </p>
          )}
          {error ? (
            <p role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <Button size="lg" block onClick={finish} loading={busy} disabled={!prayer.available}>
              Mulai perjalanan
            </Button>
            <Button variant="ghost" onClick={() => setStep("region")}>
              Ubah wilayah
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
