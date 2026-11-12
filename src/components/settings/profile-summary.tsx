"use client";

import { Bell, ChartColumn, ChevronRight, CircleHelp, Laptop, Settings, UserCog, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { LoadGate } from "@/components/providers/load-gate";
import { useLoad } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { formatDateLong, tzLabel } from "@/lib/format-id";
import { levelTitle } from "@/components/dashboard/content-lookup";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";

const LINKS: [string, string, LucideIcon][] = [
  ["/reports", "Laporan", ChartColumn],
  ["/notifications", "Notifikasi", Bell],
  ["/settings", "Pengaturan", Settings],
  ["/settings/devices", "Perangkat aktif", Laptop],
  ["/settings/account", "Akun dan data", UserCog],
  ["/help", "Bantuan", CircleHelp],
];

export function ProfileSummary() {
  const { auth } = useAuth();
  const [email, setEmail] = React.useState<string | null>(null);
  React.useEffect(() => {
    void auth?.getSession().then((s) => setEmail(s.user?.email ?? null));
  }, [auth]);
  const { data, error, loading, reload } = useLoad(async (l) => {
    const [profile, level] = await Promise.all([l.profile.getProfile(), l.progress.getCurrentLevel()]);
    return { profile, level: level.level };
  });
  return (
    <>
      <PageHeader title="Profil" />
      <LoadGate data={data} error={error} loading={loading} onRetry={reload}>
        {({ profile, level }) => (
          <div className="flex flex-col gap-6">
            <Card className="flex flex-col gap-2">
              <p className="text-card-title font-semibold">{profile.display_name ?? "Tanpa nama"}</p>
              {email ? <p className="text-text-muted">{email}</p> : null}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 pt-2">
                <dt className="text-text-muted">Level</dt>
                <dd>
                  {level}: {levelTitle(level)}
                </dd>
                <dt className="text-text-muted">Zona waktu</dt>
                <dd>{tzLabel(profile.timezone)}</dd>
                {profile.program_start_date ? (
                  <>
                    <dt className="text-text-muted">Mulai program</dt>
                    <dd>{formatDateLong(profile.program_start_date)}</dd>
                  </>
                ) : null}
              </dl>
            </Card>
            <Card as="div" className="p-0">
              <ul>
                {LINKS.map(([href, label, Icon]) => (
                  <li key={href}>
                    <Link href={href} className="flex min-h-14 items-center gap-3 px-5 hover:bg-surface-2">
                      <Icon aria-hidden className="size-5 text-text-muted" strokeWidth={1.75} />
                      <span className="flex-1">{label}</span>
                      <ChevronRight aria-hidden className="size-5 text-text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </LoadGate>
    </>
  );
}
