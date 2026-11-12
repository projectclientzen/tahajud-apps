"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { LoadGate } from "@/components/providers/load-gate";
import { useLoad } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { AppearanceSection } from "./appearance-section";
import { LocationSection } from "./location-section";
import { NotificationSection } from "./notification-section";
import { PlannerSection } from "./planner-section";

const SECTIONS = [
  ["tampilan", "Tampilan"],
  ["jam-bangun", "Jam bangun"],
  ["pengingat", "Pengingat"],
  ["wilayah", "Wilayah"],
] as const;

export function SettingsScreen() {
  const { data, error, loading, reload } = useLoad(async (l) => {
    const [profile, prefs, regions, fajr, level] = await Promise.all([
      l.profile.getProfile(),
      l.notifications.getPreferences(),
      l.prayer.listRegions(),
      l.prayer.getNextFajr(),
      l.progress.getCurrentLevel(),
    ]);
    return { profile, prefs, regions, fajr, level: level.level };
  });
  const [profile, setProfile] = React.useState<NonNullable<typeof data>["profile"] | null>(null);
  const [prefs, setPrefs] = React.useState<NonNullable<typeof data>["prefs"] | null>(null);
  React.useEffect(() => {
    if (data) {
      setProfile(data.profile);
      setPrefs(data.prefs);
    }
  }, [data]);

  return (
    <>
      <PageHeader title="Pengaturan" />
      <LoadGate
        data={data && profile && prefs ? { ...data, profile, prefs } : null}
        error={error}
        loading={loading || (!!data && !profile)}
        onRetry={reload}
      >
        {(d) => (
          <div className="flex flex-col gap-6">
            <nav aria-label="Bagian pengaturan" className="-mt-2">
              <ul className="flex flex-wrap gap-2">
                {SECTIONS.map(([id, label]) => (
                  <li key={id}>
                    <a
                      href={`#${id}`}
                      className="inline-flex min-h-11 items-center rounded-full border border-border-strong bg-surface px-4 text-helper font-medium hover:bg-surface-2"
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <AppearanceSection profile={d.profile} onChange={setProfile} />
            <PlannerSection prefs={d.prefs} onPrefs={setPrefs} fajr={d.fajr} level={d.level} />
            <NotificationSection prefs={d.prefs} onPrefs={setPrefs} />
            <LocationSection profile={d.profile} regions={d.regions} fajr={d.fajr} />
            <Card as="div" className="flex flex-col gap-1 p-0">
              {(
                [
                  ["/settings/devices", "Perangkat aktif"],
                  ["/settings/account", "Akun dan data"],
                ] as const
              ).map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  className="flex min-h-14 items-center justify-between gap-3 rounded-[var(--radius-card)] px-5 hover:bg-surface-2"
                >
                  {label}
                  <ChevronRight aria-hidden className="size-5 text-text-muted" />
                </Link>
              ))}
            </Card>
          </div>
        )}
      </LoadGate>
    </>
  );
}
