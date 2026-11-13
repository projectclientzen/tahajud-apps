"use client";

import Link from "next/link";
import { useAdmin } from "./admin-gate";
import { useAdminGet } from "./api";
import { Empty, Load, PageTitle, Section, Tag, type Tone } from "./ui";

interface Card {
  key: string;
  label: string;
  state: "ok" | "warn" | "error" | "unknown" | "not_configured";
  summary: string;
  facts: { label: string; value: string }[];
}
interface Shown {
  hidden: boolean;
  total: number | null;
  groups: { key: string; n: number; merged?: string[] }[];
}
interface Dash {
  roles: string[];
  aggregates?: {
    k: number;
    accounts: number | null;
    active_users: number | null;
    entitlements: Shown;
    onboarding: Shown;
    levels: Shown;
    completed_nights: Shown;
    recent_activity: { key: string; n: number | null }[];
  };
  integrations?: Card[];
  queues?: { entitlements_pending?: number; content_in_review?: number };
}

const CARD_TONE: Record<Card["state"], { tone: Tone; label: string }> = {
  ok: { tone: "good", label: "Normal" },
  warn: { tone: "warn", label: "Perlu dicek" },
  error: { tone: "bad", label: "Bermasalah" },
  unknown: { tone: "neutral", label: "Belum ada data" },
  not_configured: { tone: "neutral", label: "Belum dikonfigurasi" },
};

const GROUP_LABEL: Record<string, string> = {
  active: "Aktif", pending_verification: "Menunggu verifikasi", suspended: "Ditangguhkan", revoked: "Dicabut", expired: "Kedaluwarsa",
  done: "Onboarding selesai", not_done: "Onboarding belum selesai", level_1: "Level 1", level_2: "Level 2", level_3: "Level 3",
  "0": "0 malam", "1_6": "1 sampai 6 malam", "7_13": "7 sampai 13 malam", "14_plus": "14 malam atau lebih", other: "Lainnya (digabung)",
  "7_days": "Aktif 7 hari terakhir", "30_days": "Aktif 30 hari terakhir",
};

export function DashboardView() {
  const me = useAdmin();
  const state = useAdminGet<Dash>("/dashboard");
  return (
    <>
      <PageTitle title="Ringkasan" description="Yang perlu ditangani dulu, lalu kondisi integrasi dan angka agregat." />
      <Load state={state} rows={4}>
        {(d) => {
          const todo: { href: string; text: string }[] = [];
          if (d.queues?.entitlements_pending) todo.push({ href: "/admin/purchases?filter=pending", text: `${d.queues.entitlements_pending} akses menunggu persetujuan manual` });
          if (d.queues?.content_in_review) todo.push({ href: "/admin/review", text: `${d.queues.content_in_review} perubahan konten menunggu review` });
          for (const c of d.integrations ?? []) if (c.state === "error" || c.state === "warn") todo.push({ href: c.key === "jobs" ? "/admin/jobs" : c.key === "prayer" ? "/admin/prayer-times" : "/admin/purchases?filter=quarantine", text: `${c.label}: ${c.summary}` });
          return (
            <>
              <Section title="Perlu ditangani">
                {todo.length === 0 ? (
                  <Empty title="Tidak ada yang menunggu" hint={me.roles.includes("reporting_admin") && d.roles.length === 1 ? "Peranmu hanya melihat angka agregat." : "Antrean persetujuan kosong dan tidak ada integrasi bermasalah."} />
                ) : (
                  <ul className="flex flex-col gap-2">
                    {todo.map((t) => (
                      <li key={t.text}>
                        <Link href={t.href} className="flex min-h-12 items-center rounded-[var(--radius-control)] border border-border bg-surface px-4 py-3 hover:bg-surface-2">
                          {t.text}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {d.integrations ? (
                <Section title="Integrasi" description="Dinilai dari hitungan nyata di database. Kalau belum ada data, kartu bilang belum ada data, bukan hijau.">
                  <div className="grid gap-3 md:grid-cols-2">
                    {d.integrations.map((c) => (
                      <article key={c.key} className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-surface-2 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-semibold">{c.label}</h3>
                          <Tag tone={CARD_TONE[c.state].tone}>{CARD_TONE[c.state].label}</Tag>
                        </div>
                        <p>{c.summary}</p>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-helper">
                          {c.facts.map((f) => (
                            <div key={f.label}>
                              <dt className="text-text-muted">{f.label}</dt>
                              <dd className="font-medium">{f.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </article>
                    ))}
                  </div>
                </Section>
              ) : null}

              {d.aggregates ? <Aggregates a={d.aggregates} /> : null}
            </>
          );
        }}
      </Load>
    </>
  );
}

function Aggregates({ a }: { a: NonNullable<Dash["aggregates"]> }) {
  const sets: { title: string; shown: Shown }[] = [
    { title: "Akses", shown: a.entitlements },
    { title: "Onboarding", shown: a.onboarding },
    { title: "Level saat ini", shown: a.levels },
    { title: "Malam selesai per pengguna", shown: a.completed_nights },
  ];
  return (
    <Section
      title="Angka agregat"
      description={`Angka di bawah ${a.k} pengguna tidak ditampilkan, dan kelompok kecil digabung supaya tidak bisa dihitung mundur. Akun staf tidak dihitung. Tidak ada data per orang.`}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Akun pembeli" value={a.accounts} k={a.k} />
        <Stat label="Pengguna dengan akses aktif" value={a.active_users} k={a.k} />
        {a.recent_activity.map((r) => (
          <Stat key={r.key} label={GROUP_LABEL[r.key] ?? r.key} value={r.n} k={a.k} />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {sets.map(({ title, shown }) => (
          <div key={title} className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-surface-2 p-4">
            <h3 className="font-semibold">{title}</h3>
            {shown.hidden ? (
              <p className="text-text-muted">Kurang dari {a.k} pengguna, disembunyikan.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {shown.groups.map((g) => (
                  <li key={g.key} className="flex items-baseline justify-between gap-3">
                    <span>{GROUP_LABEL[g.key] ?? g.key}</span>
                    <span className="font-semibold tabular-nums">{g.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

function Stat({ label, value, k }: { label: string; value: number | null; k: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-[var(--radius-card)] bg-surface-2 p-4">
      <span className="text-helper text-text-muted">{label}</span>
      {value === null ? <span className="text-text-muted">Kurang dari {k}, disembunyikan</span> : <span className="text-stat font-semibold tabular-nums">{value}</span>}
    </div>
  );
}
