"use client";

import { MapPinned } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { fieldClass } from "@/components/auth/auth-frame";
import { errorMessage, useData, useLoad } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/feedback-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { LocationUpdate, PrayerTime } from "@/data";
import { cn } from "@/lib/cn";
import { formatClock, tzLabel } from "@/lib/format-id";
import { requestPersistentStorage } from "@/offline";
import { StepHeader } from "./step-header";

type Step = "welcome" | "region" | "confirm";
const TOTAL = 3;
const ZONES = [
  { value: "Asia/Jakarta", label: "WIB (Jakarta)" },
  { value: "Asia/Makassar", label: "WITA (Makassar)" },
  { value: "Asia/Jayapura", label: "WIT (Jayapura)" },
];

/**
 * Minimum path (PRD §6.2): welcome, region or manual schedule, confirm Subuh, then the dashboard.
 * Three screens, nothing else is required. Extra steps live at /onboarding/extra and on dashboard cards.
 */
export function OnboardingFlow() {
  const router = useRouter();
  const { layer } = useData();
  const [step, setStep] = React.useState<Step>("welcome");
  const [prayer, setPrayer] = React.useState<PrayerTime | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);

  // A new step is a new screen: send focus to its heading so keyboard and screen reader users start there.
  React.useEffect(() => heading.current?.focus(), [step]);

  async function saveLocation(req: LocationUpdate) {
    if (!layer) return;
    setBusy(true);
    setError(null);
    try {
      setPrayer(await layer.profile.setLocation(req));
      setStep("confirm");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish(next: string) {
    if (!layer) return;
    setBusy(true);
    setError(null);
    try {
      // Ask the browser to keep this site's data (PRD §21.1). "denied" is normal and does not block anything.
      await requestPersistentStorage();
      await layer.profile.completeOnboarding();
      router.replace(next);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  if (step === "welcome") {
    return (
      <div className="flex flex-col gap-6">
        <StepHeader
          ref={heading}
          step={1}
          total={TOTAL}
          title="Selamat datang di Tahajud Tracker"
          description="Dua langkah singkat lagi: pilih wilayah salatmu, lalu cek jam Subuh. Setelah itu kamu bisa langsung mulai."
        />
        <ul className="flex flex-col gap-2 text-text-muted">
          <li>Catat salat malam dan dzikir, satu malam demi satu malam.</li>
          <li>Progress tidak hilang kalau ada malam yang terlewat.</li>
          <li>Tetap bisa dipakai saat sinyal lemah.</li>
        </ul>
        <Button size="lg" block onClick={() => setStep("region")}>
          Mulai
        </Button>
      </div>
    );
  }

  if (step === "region") {
    return (
      <RegionStep
        headingRef={heading}
        busy={busy}
        error={error}
        onSubmit={(req) => void saveLocation(req)}
        onBack={() => setStep("welcome")}
      />
    );
  }

  const fajr = prayer?.fajr_at ? `${formatClock(prayer.fajr_at, prayer.timezone)} ${tzLabel(prayer.timezone)}` : null;
  return (
    <div className="flex flex-col gap-6">
      <StepHeader
        ref={heading}
        step={3}
        total={TOTAL}
        title="Cek jam Subuh"
        description="Jam bangun dan pengingat dihitung dari sini. Kamu bisa mengubahnya kapan saja di Pengaturan."
      />
      <div className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <p className="text-helper text-text-muted">{prayer?.region_name ?? "Jadwal manual"}</p>
        {fajr ? (
          <p className="text-stat font-semibold tabular-nums" data-testid="fajr-confirm">
            {fajr}
          </p>
        ) : (
          <p>Jadwal Subuh belum tersedia. Atur jadwal manual supaya bisa lanjut.</p>
        )}
        {prayer?.label ? <p className="text-helper text-text-muted">{prayer.label}</p> : null}
        {prayer?.demo_note ? <p className="text-helper text-text-muted">{prayer.demo_note}</p> : null}
      </div>
      {error ? <ErrorState title="Belum berhasil" description={error} /> : null}
      <div className="flex flex-col gap-2">
        <Button size="lg" block loading={busy} disabled={!fajr} onClick={() => void finish("/dashboard")}>
          Benar, mulai sekarang
        </Button>
        <Button variant="secondary" block disabled={busy || !fajr} onClick={() => void finish("/onboarding/extra")}>
          Atur langkah tambahan dulu
        </Button>
        <Button variant="ghost" block disabled={busy} onClick={() => setStep("region")}>
          Ubah wilayah
        </Button>
      </div>
    </div>
  );
}

function RegionStep({
  headingRef,
  busy,
  error,
  onSubmit,
  onBack,
}: {
  headingRef: React.Ref<HTMLHeadingElement>;
  busy: boolean;
  error: string | null;
  onSubmit: (req: LocationUpdate) => void;
  onBack: () => void;
}) {
  const regions = useLoad((l) => l.prayer.listRegions());
  const [mode, setMode] = React.useState<"region" | "manual">("region");
  const [regionId, setRegionId] = React.useState<string | null>(null);
  const [zone, setZone] = React.useState(ZONES[0]!.value);
  const [fajr, setFajr] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "region") {
      if (!regionId) return setFormError("Pilih wilayah dulu, atau atur jadwal manual.");
      onSubmit({ mode: "region", region_id: regionId });
    } else {
      if (!/^\d{2}:\d{2}$/.test(fajr)) return setFormError("Isi jam Subuh, misalnya 04:35.");
      onSubmit({ mode: "manual", timezone: zone, fajr_time: fajr });
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <StepHeader
        ref={headingRef}
        step={2}
        total={TOTAL}
        title={mode === "region" ? "Pilih wilayah salatmu" : "Atur jadwal manual"}
        description={
          mode === "region"
            ? "Jadwal Subuh mengikuti wilayah ini."
            : "Pakai ini kalau wilayahmu tidak ada di daftar, atau kamu sedang bepergian."
        }
      />

      {mode === "region" ? (
        regions.loading ? (
          <Skeleton className="h-40 w-full" />
        ) : regions.error || !regions.data ? (
          <ErrorState
            title="Daftar wilayah belum bisa dimuat"
            description="Kamu tetap bisa atur jadwal manual."
            action={
              <Button type="button" variant="secondary" onClick={regions.reload}>
                Coba lagi
              </Button>
            }
          />
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Wilayah</legend>
            {regions.data.map((r) => (
              <label
                key={r.id}
                className={cn(
                  "flex min-h-14 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border px-4 py-2",
                  "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
                  regionId === r.id ? "border-primary bg-primary-soft" : "border-border-strong bg-surface",
                )}
              >
                <input
                  type="radio"
                  name="region"
                  value={r.id}
                  checked={regionId === r.id}
                  onChange={() => {
                    setRegionId(r.id);
                    setFormError(null);
                  }}
                  className="size-5 accent-[var(--primary)]"
                />
                <MapPinned aria-hidden className="size-5 shrink-0 text-text-muted" />
                <span className="font-semibold">{r.name}</span>
              </label>
            ))}
          </fieldset>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="zone" className="font-semibold">
              Zona waktu
            </label>
            <select id="zone" value={zone} onChange={(e) => setZone(e.target.value)} className={fieldClass}>
              {ZONES.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="fajr" className="font-semibold">
              Jam Subuh
            </label>
            <input
              id="fajr"
              type="time"
              value={fajr}
              onChange={(e) => {
                setFajr(e.target.value);
                setFormError(null);
              }}
              className={fieldClass}
            />
            <p className="text-helper text-text-muted">
              Ambil dari jadwal salat di masjid atau aplikasi yang kamu percaya.
            </p>
          </div>
        </div>
      )}

      {formError || error ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-text">
          {formError ?? error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" block loading={busy}>
          Lanjut
        </Button>
        <Button
          type="button"
          variant="secondary"
          block
          disabled={busy}
          onClick={() => {
            setMode(mode === "region" ? "manual" : "region");
            setFormError(null);
          }}
        >
          {mode === "region" ? "Atur jadwal manual" : "Pilih dari daftar wilayah"}
        </Button>
        <Button type="button" variant="ghost" block disabled={busy} onClick={onBack}>
          Kembali
        </Button>
      </div>
    </form>
  );
}
