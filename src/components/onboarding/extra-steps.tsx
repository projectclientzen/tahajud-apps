"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { fieldClass } from "@/components/auth/auth-frame";
import { errorMessage, useData, useLoad } from "@/components/providers/data-provider";
import { levelTitle } from "@/components/dashboard/content-lookup";
import { InstallGuide } from "@/components/pwa/install-guide";
import { Button } from "@/components/ui/button";
import { PROVISIONAL_SETTINGS } from "@/domain/config/provisional";
import { getLevelConfig, nightDhikrTotal, nightRakaatTotal } from "@/domain/content";
import { NotificationSetup } from "./notification-setup";
import { StepHeader } from "./step-header";

const TOTAL = 4;

function LevelsStep() {
  return (
    <ol className="flex flex-col gap-3">
      {([1, 2, 3] as const).map((n) => {
        const cfg = getLevelConfig(n);
        const s = PROVISIONAL_SETTINGS.levels[n];
        return (
          <li key={n} className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
            <p className="font-semibold">
              Level {n}: {levelTitle(n)}
            </p>
            <p className="text-text-muted">
              {nightRakaatTotal(cfg)} rakaat, {nightDhikrTotal(cfg).toLocaleString("id-ID")} hitungan dzikir, sekitar{" "}
              {s.estimatedDurationMinutes} menit. Naik level setelah {s.requiredSuccessfulNights} malam tuntas.
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function SleepStep() {
  const { layer } = useData();
  const prefs = useLoad((l) => l.notifications.getPreferences());
  const [value, setValue] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const shown = value ?? prefs.data?.bedtime.target_sleep_time ?? "";

  async function save() {
    if (!layer || !prefs.data || !/^\d{2}:\d{2}$/.test(shown)) return;
    setBusy(true);
    setError(null);
    try {
      await layer.notifications.putPreferences({
        ...prefs.data,
        bedtime: { ...prefs.data.bedtime, target_sleep_time: shown },
      });
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="sleep" className="font-semibold">
        Target jam tidur
      </label>
      <input
        id="sleep"
        type="time"
        value={shown}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        className={fieldClass}
      />
      <Button variant="secondary" loading={busy} disabled={!prefs.data || shown === ""} onClick={() => void save()}>
        Simpan
      </Button>
      {saved ? (
        <p role="status" className="rounded-[var(--radius-control)] bg-success-soft p-3">
          Tersimpan. Pengingat tidur dihitung dari jam ini.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const STEPS = [
  {
    title: "Kenali tiga level",
    description: "Kamu mulai dari Level 1. Level berikutnya terbuka bertahap.",
    body: <LevelsStep />,
  },
  {
    title: "Target jam tidur",
    description: "Tidur lebih awal membuat bangun malam lebih ringan.",
    body: <SleepStep />,
  },
  { title: "Aktifkan pengingat", description: "Pengingat tidur, tahajud, dan Subuh.", body: <NotificationSetup /> },
  {
    title: "Pasang di layar utama",
    description: "Buka lebih cepat dan tetap bisa dipakai saat sinyal lemah.",
    body: <InstallGuide />,
  },
];

/** Optional steps (PRD §6.2). Every step can be skipped, and skipped ones come back as dashboard cards. */
export function ExtraSteps() {
  const router = useRouter();
  const [i, setI] = React.useState(0);
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => heading.current?.focus(), [i]);
  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;
  const go = () => (last ? router.replace("/dashboard") : setI(i + 1));

  return (
    <div className="flex flex-col gap-6">
      <StepHeader ref={heading} step={i + 1} total={TOTAL} title={step.title} description={step.description} />
      {step.body}
      <div className="flex flex-col gap-2">
        <Button size="lg" block onClick={go}>
          {last ? "Selesai, ke dashboard" : "Lanjut"}
        </Button>
        {last ? null : (
          <Button variant="ghost" block onClick={go}>
            Lewati
          </Button>
        )}
        <Button variant="ghost" block onClick={() => router.replace("/dashboard")}>
          Ke dashboard sekarang
        </Button>
      </div>
      <p className="text-center text-helper text-text-muted">
        Langkah yang dilewati muncul sebagai kartu di dashboard.
      </p>
    </div>
  );
}
