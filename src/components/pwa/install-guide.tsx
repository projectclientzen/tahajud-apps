"use client";

import { Check, CircleCheck } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { detectPlatform, isStandalone, type InstallPlatform } from "@/offline/platform";

type Guide = "android" | "ios" | "desktop";

const OPTIONS: { value: Guide; label: string }[] = [
  { value: "android", label: "Android" },
  { value: "ios", label: "iPhone atau iPad" },
  { value: "desktop", label: "Komputer" },
];

const STEPS: Record<Guide, string[]> = {
  android: [
    "Buka aplikasi ini di Chrome.",
    "Ketuk menu titik tiga di pojok kanan atas.",
    "Pilih Instal aplikasi, atau Tambahkan ke layar utama.",
    "Ketuk Instal. Ikon Tahajud muncul di layar utama.",
  ],
  ios: [
    "Buka halaman ini di Safari.",
    "Ketuk tombol Bagikan, kotak dengan panah ke atas di bilah bawah.",
    "Gulir, lalu pilih Tambah ke Layar Utama.",
    "Ketuk Tambah. Buka Tahajud dari ikon di layar utama.",
  ],
  desktop: [
    "Buka aplikasi ini di Chrome atau Edge.",
    "Klik ikon pasang di ujung kanan kolom alamat. Atau buka menu titik tiga, lalu Instal Tahajud Tracker.",
    "Klik Instal.",
  ],
};

const NOTES: Partial<Record<Guide, string>> = {
  ios: "Notifikasi hanya bisa diaktifkan setelah aplikasi dibuka dari ikon di Layar Utama. Butuh iOS 16.4 atau lebih baru.",
  desktop: "Safari di Mac: pilih menu File, lalu Tambah ke Dock. Firefox belum bisa memasang aplikasi.",
};

const toGuide = (p: InstallPlatform): Guide =>
  p === "android" ? "android" : p === "ios-safari" || p === "ios-other" ? "ios" : "desktop";

function subscribeStandalone(cb: () => void) {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

const readStandalone = () =>
  isStandalone({
    matchMedia: (q) => window.matchMedia(q),
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
  });

/** Install steps per platform. Placement on screens happens in round 3. */
export function InstallGuide({ className }: { className?: string }) {
  const name = useId();
  const standalone = useSyncExternalStore(subscribeStandalone, readStandalone, () => false);
  const [detected, setDetected] = useState<InstallPlatform | null>(null);
  const [guide, setGuide] = useState<Guide>("android");

  useEffect(() => {
    const p = detectPlatform({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      platform: navigator.platform,
    });
    setDetected(p);
    setGuide(toGuide(p));
  }, []);

  if (standalone) {
    return (
      <Card className={cn("flex items-center gap-3", className)}>
        <CircleCheck aria-hidden className="size-6 shrink-0 text-success" />
        <p className="text-body">Aplikasi sudah terpasang di perangkat ini.</p>
      </Card>
    );
  }

  return (
    <Card aria-labelledby={`${name}-title`} className={className}>
      <CardTitle id={`${name}-title`}>Pasang di perangkatmu</CardTitle>
      <p className="mt-1 text-helper text-text-muted">
        Dengan terpasang, aplikasi terbuka lebih cepat dan tetap bisa dipakai saat sinyal lemah.
      </p>

      <fieldset className="mt-4">
        <legend className="mb-2 text-helper font-semibold">Pilih perangkat</legend>
        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={cn(
                "inline-flex min-h-12 cursor-pointer items-center rounded-[var(--radius-control)] border px-4 text-body font-semibold",
                "border-border-strong bg-surface has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-on-primary",
                "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]",
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={guide === o.value}
                onChange={() => setGuide(o.value)}
                className="sr-only"
              />
              {guide === o.value && <Check aria-hidden className="mr-1.5 size-4 shrink-0" />}
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      {detected === "ios-other" && guide === "ios" && (
        <p className="mt-4 rounded-[var(--radius-control)] bg-warning-soft p-3 text-helper">
          Browser ini mungkin belum bisa memasang aplikasi di iPhone. Cara paling pasti: buka halaman ini di Safari.
        </p>
      )}

      <ol className="mt-4 list-decimal space-y-2 pl-6 text-body marker:font-semibold">
        {STEPS[guide].map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {NOTES[guide] && <p className="mt-4 text-helper text-text-muted">{NOTES[guide]}</p>}
    </Card>
  );
}
