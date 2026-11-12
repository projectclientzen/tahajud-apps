import { BadgeCheck, CircleHelp, TriangleAlert } from "lucide-react";
import type { PrayerTime } from "@/data";

/** Fixed attribution for the schedule provider (PRD v1.2, docs/PROVIDER-EQURAN.md). */
export const SCHEDULE_ATTRIBUTION = "Bimas Islam Kemenag RI via EQuran.id";

export type ScheduleVerification = "verified" | "needs_review" | "unverified";

export interface ScheduleNoteInfo {
  /** "Jadwal terkini", "Jadwal tersimpan", "Diatur manual", or the unavailable line. */
  source: string;
  /** Null for manual schedules and when no schedule exists: nothing was cross-checked. */
  verification: ScheduleVerification | null;
  /** Shown only for a real provider schedule, never for demo data or a manual schedule. */
  attribution: string | null;
  demoNote: string | null;
}

/** Pure. "verified" comes only from verification === "verified". Everything else is not verified. */
export function scheduleNote(
  pt: Pick<PrayerTime, "available" | "source" | "label" | "demo_note" | "verification">,
): ScheduleNoteInfo {
  if (!pt.available) {
    return { source: pt.label ?? "Jadwal belum tersedia", verification: null, attribution: null, demoNote: null };
  }
  const fromProvider = pt.source === "provider" || pt.source === "cached";
  const demo = pt.demo_note ?? null;
  let verification: ScheduleVerification | null = null;
  if (fromProvider) {
    verification =
      pt.verification === "verified" ? "verified" : pt.verification === "needs_review" ? "needs_review" : "unverified";
  }
  return {
    source: pt.label ?? "Jadwal tersedia",
    verification,
    attribution: fromProvider && !demo ? SCHEDULE_ATTRIBUTION : null,
    demoNote: demo,
  };
}

export const VERIFICATION_LABEL: Record<ScheduleVerification, string> = {
  verified: "Terverifikasi",
  needs_review: "Perlu dicek ulang",
  unverified: "Belum diverifikasi",
};

/** One short block: source label, verification state (icon plus text), provider attribution. */
export function ScheduleNote({ fajr, className }: { fajr: PrayerTime; className?: string }) {
  const n = scheduleNote(fajr);
  const Icon =
    n.verification === "verified" ? BadgeCheck : n.verification === "needs_review" ? TriangleAlert : CircleHelp;
  return (
    <div className={className ?? "flex flex-col gap-1 text-helper text-text-muted"} data-testid="schedule-note">
      <p>
        {n.source}
        {n.demoNote ? `. ${n.demoNote}` : ""}
      </p>
      {n.verification ? (
        <p className="flex items-center gap-1.5" data-verification={n.verification}>
          <Icon aria-hidden className="size-4 shrink-0" />
          {VERIFICATION_LABEL[n.verification]}
        </p>
      ) : null}
      {n.attribution ? <p>Sumber: {n.attribution}</p> : null}
    </div>
  );
}
