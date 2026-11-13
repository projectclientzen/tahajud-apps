"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { fieldClass } from "@/components/auth/auth-shell";
import { errorMessage, useData, useLoad } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import type { PrayerTime, Region } from "@/data";
import { autoLocate, AUTO_LOCATE_MESSAGE, type AutoLocateResult } from "@/lib/auto-location";
import { formatClock, formatDateLong, tzLabel } from "@/lib/format-id";
import { cn } from "@/lib/cn";
import { requestPersistentStorage } from "@/offline";

type Step = "welcome" | "region" | "confirm";
const STEPS: Step[] = ["welcome", "region", "confirm"];

/** Regions shown at once in the manual list. The rest is reached by typing in the search box. */
const LIST_LIMIT = 12;

/** A region the user can pick by hand, with a search box so a list of 500 stays usable on a phone. */
function RegionPicker({ regions, value, onChange }: { regions: Region[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const matches = needle ? regions.filter((r) => r.name.toLowerCase().includes(needle)) : regions;
  // The chosen region stays on screen even when the search no longer matches it.
  const shown = matches.slice(0, LIST_LIMIT);
  const chosen = regions.find((r) => r.id === value);
  if (chosen && !shown.some((r) => r.id === chosen.id)) shown.unshift(chosen);
  return (
    <div className="flex flex-col gap-3">
      {regions.length > LIST_LIMIT ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="ob-search" className="font-semibold">
            Cari wilayah
          </label>
          <input
            id="ob-search"
            type="search"
            className={fieldClass}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ketik nama kota atau kabupaten"
            autoComplete="off"
          />
        </div>
      ) : null}
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1 font-semibold">Wilayah</legend>
        {shown.map((r) => (
          <label
            key={r.id}
            className="flex min-h-14 items-center gap-3 rounded-[var(--radius-control)] border border-border px-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
          >
            <input
              type="radio"
              name="region"
              className="size-5 accent-[var(--primary)]"
              checked={value === r.id}
              onChange={() => onChange(r.id)}
            />
            {r.name}
          </label>
        ))}
        {matches.length === 0 ? <p className="text-text-muted">Tidak ada wilayah dengan nama itu.</p> : null}
        {matches.length > LIST_LIMIT ? (
          <p className="text-helper text-text-muted" role="status">
            Menampilkan {LIST_LIMIT} dari {matches.length} wilayah. Ketik di kolom cari untuk mempersempit.
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}

/** Minimum path (PRD §6.2): welcome, region or manual schedule, confirm Fajr. Everything else is a card on the dashboard. */
export function OnboardingFlow() {
  const { layer } = useData();
  const router = useRouter();
  const regions = useLoad((l) => l.prayer.listRegions());
  const [step, setStep] = React.useState<Step>("welcome");
  const [regionId, setRegionId] = React.useState("");
  const [locating, setLocating] = React.useState(false);
  const [found, setFound] = React.useState<Extract<AutoLocateResult, { kind: "found" }> | null>(null);
  const [autoNote, setAutoNote] = React.useState<string | null>(null);
  const [prayer, setPrayer] = React.useState<PrayerTime | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  /** One tap: read the position on this device, find the nearest city, and ask the user to confirm it. */
  async function useAutoLocation() {
    setLocating(true);
    setAutoNote(null);
    setFound(null);
    const r = await autoLocate(regions.data ?? []);
    setLocating(false);
    if (r.kind === "found") setFound(r);
    else setAutoNote(AUTO_LOCATE_MESSAGE[r.kind]);
  }

  async function saveLocation(id: string = regionId) {
    if (!layer) return;
    setBusy(true);
    setError(null);
    try {
      const p = await layer.profile.setLocation({ mode: "region", region_id: id });
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

  const canContinue = regionId !== "";
  const foundRegion = found ? (regions.data ?? []).find((r) => r.id === found.regionId) : undefined;
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
              Dua langkah singkat: tentukan wilayah, lalu cek jadwal Subuh. Pengingat dan panduan pasang aplikasi bisa
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
            <p className="text-text-muted">
              Jadwal Subuh mengikuti wilayah. Lokasi hanya dipakai sekali untuk mencari kota terdekat di perangkatmu.
              Titik GPS tidak dikirim dan tidak disimpan.
            </p>
          </div>

          {found ? (
            <div
              role="group"
              aria-label="Konfirmasi lokasi"
              className="flex flex-col gap-3 rounded-[var(--radius-card)] border-2 border-primary bg-primary-soft/40 p-5"
            >
              <p className="text-card-title font-semibold" data-testid="auto-place">
                Lokasimu: {foundRegion?.name ?? found.place}. Benar?
              </p>
              <p className="text-helper text-text-muted">
                Ini perkiraan dari titik pusat kota terdekat. Di dekat perbatasan hasilnya bisa meleset.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  size="lg"
                  onClick={() => {
                    setRegionId(found.regionId);
                    void saveLocation(found.regionId);
                  }}
                  loading={busy}
                >
                  Benar, lanjut
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  onClick={() => {
                    setFound(null);
                    setAutoNote("Pilih wilayahmu dari daftar di bawah.");
                  }}
                  disabled={busy}
                >
                  Bukan, pilih sendiri
                </Button>
              </div>
            </div>
          ) : (
            <Button size="lg" block onClick={useAutoLocation} loading={locating} disabled={regions.loading}>
              Pakai lokasi otomatis
            </Button>
          )}
          {autoNote ? (
            <p role="status" className="rounded-[var(--radius-control)] bg-surface-2 p-3" data-testid="auto-note">
              {autoNote}
            </p>
          ) : null}

          {found ? null : (
            <>
              <h2 className="pt-2 text-card-title font-semibold">Atau pilih wilayah sendiri</h2>
              <RegionPicker regions={regions.data ?? []} value={regionId} onChange={setRegionId} />
              {error ? (
                <p role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-col gap-2">
                <Button size="lg" block onClick={() => saveLocation()} loading={busy} disabled={!canContinue}>
                  Lanjut
                </Button>
                <Button variant="ghost" onClick={() => setStep("welcome")}>
                  Kembali
                </Button>
              </div>
            </>
          )}
          {found && error ? (
            <p role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
              {error}
            </p>
          ) : null}
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
            <Button
              variant="ghost"
              onClick={() => {
                setFound(null);
                setStep("region");
              }}
            >
              Ubah wilayah
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
