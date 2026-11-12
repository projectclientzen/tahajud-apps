"use client";

import { Sunrise } from "lucide-react";
import * as React from "react";
import { LoadGate } from "@/components/providers/load-gate";
import { errorMessage, useData, useLoad, useNow } from "@/components/providers/data-provider";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback-state";
import { StatusChip } from "@/components/ui/status-chip";
import type { NightSession, PrayerTime, SessionSummary } from "@/data";
import { formatDateLong, formatDuration } from "@/lib/format-id";
import { levelTitle } from "@/components/dashboard/content-lookup";
import { ActivityRow } from "./activity-row";

const PHASES = [
  { key: "night", title: "Malam", hint: "Salat malam, dzikir, doa, dan tilawah." },
  { key: "fajr", title: "Subuh", hint: "Qabliyah dan salat Subuh." },
  { key: "post_fajr", title: "Setelah Subuh", hint: "Dzikir lanjutan dan bacaan setelah Subuh." },
] as const;

interface Loaded {
  session: NightSession | null;
  prayer: PrayerTime | null;
  summary: SessionSummary | null;
}

function FajrBanner({ prayer }: { prayer: PrayerTime | null }) {
  const now = useNow();
  if (!prayer?.available || !prayer.fajr_at || !now) return null;
  const ms = new Date(prayer.fajr_at).getTime() - now.getTime();
  if (ms <= 0) {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-[var(--radius-card)] bg-highlight-soft p-4"
        data-testid="fajr-banner"
      >
        <Sunrise aria-hidden className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold">Waktu Subuh telah masuk</p>
          <p className="text-text-muted">
            Amalan malam yang belum lengkap tetap bisa dicatat sampai sesi ditutup. Tidak ada yang dicentang otomatis.
          </p>
        </div>
      </div>
    );
  }
  return (
    <p className="text-text-muted" data-testid="fajr-banner">
      Subuh dalam {formatDuration(ms)}.
    </p>
  );
}

function SummaryCard({ summary, state }: { summary: SessionSummary; state: NightSession["state"] }) {
  return (
    <Card as="section" className="flex flex-col gap-3" id="ringkasan">
      <CardTitle>Ringkasan sesi</CardTitle>
      {state === "in_progress" || state === "scheduled" ? (
        <span className="inline-flex min-h-7 items-center self-start rounded-full border border-border-strong px-2.5 text-helper font-medium">
          {state === "in_progress" ? "Sedang berjalan" : "Belum dimulai"}
        </span>
      ) : (
        <StatusChip status={summary.session_status} className="self-start" />
      )}
      <p>
        Malam tuntas di Level {summary.current_level} ({levelTitle(summary.current_level)}):{" "}
        {summary.successful_nights_at_level} dari {summary.required_successful_nights}.
      </p>
      {summary.next_level_unlocked && summary.next_level_effective_session_key ? (
        <p role="status" className="rounded-[var(--radius-control)] bg-success-soft p-3 text-success">
          Level berikutnya terbuka. Berlaku mulai sesi {formatDateLong(summary.next_level_effective_session_key)}.
        </p>
      ) : null}
      <CardDescription>
        Membuka ringkasan tidak mengubah status. Status dihitung otomatis dari amalan yang tercatat.
      </CardDescription>
    </Card>
  );
}

/** Active night session (PRD §6.3, §10.3, §11.4): activities by phase, Fajr transition, summary. */
export function SessionView() {
  const { layer, bump } = useData();
  const { data, error, loading, reload } = useLoad<Loaded>(async (l) => {
    const session = await l.session.getActiveSession();
    const prayer = await l.prayer.getNextFajr().catch(() => null);
    const summary = session ? await l.session.getSummary(session.id) : null;
    return { session, prayer, summary };
  });
  const [message, setMessage] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);

  async function start() {
    if (!layer) return;
    setStarting(true);
    try {
      await layer.session.ensureActiveSession();
      bump();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <PageHeader title="Ibadah malam ini" description="Catat amalan satu per satu. Yang belum selesai tidak hilang." />
      <LoadGate data={data} error={error} loading={loading} onRetry={reload}>
        {({ session, prayer, summary }) =>
          session === null ? (
            <EmptyState
              title="Sesi malam ini belum dimulai"
              description="Sesi dibuat saat kamu menekan tombol mulai. Mulailah kapan pun kamu siap."
              action={
                <Button onClick={start} loading={starting}>
                  Mulai ibadah malam ini
                </Button>
              }
            />
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-1">
                <p className="font-medium">
                  {formatDateLong(session.session_key)}, Level {session.level} {levelTitle(session.level)}
                </p>
                <p className="text-helper text-text-muted">
                  Amalan tanpa label Opsional adalah syarat sesi tuntas di aplikasi. Ini aturan penghitungan, bukan
                  hukum fikih.
                </p>
              </div>
              <FajrBanner prayer={prayer} />
              {message ? (
                <p role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
                  {message}
                </p>
              ) : null}
              {PHASES.map((p) => {
                const items = session.activities.filter((a) => a.phase === p.key);
                if (items.length === 0) return null;
                return (
                  <section key={p.key} aria-labelledby={`phase-${p.key}`} className="flex flex-col gap-1">
                    <h2 id={`phase-${p.key}`} className="text-card-title font-semibold">
                      {p.title}
                    </h2>
                    <p className="pb-1 text-helper text-text-muted">{p.hint}</p>
                    <ul className="flex flex-col">
                      {items.map((a) => (
                        <ActivityRow
                          key={a.id}
                          activity={a}
                          onChanged={() => {
                            bump();
                          }}
                          onError={setMessage}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
              {summary ? <SummaryCard summary={summary} state={session.state} /> : null}
            </div>
          )
        }
      </LoadGate>
    </>
  );
}
