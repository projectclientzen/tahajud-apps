import type { CalendarDay } from "../calendar/calendar";
import type { LevelProgress } from "../progression/progression";
import { diffDays, type LocalDate } from "../time/tz";
import { completionRate } from "./reports";

export type InsightType =
  "first_completion" | "return_after_gap" | "milestone_progress" | "improvement" | "stable_consistency";

export interface Insight {
  type: InsightType;
  message: string;
}

/**
 * Fixed Indonesian templates. No spiritual score, no ranking, no shaming (PRD §22.4).
 * Placeholders are filled with plain numbers only.
 */
export const INSIGHT_TEMPLATES: Record<InsightType, string> = {
  first_completion: "Satu sesi tuntas sudah tercatat. Awal yang baik, lanjutkan dengan ritme yang nyaman.",
  return_after_gap: "Selamat kembali. Sesi terbaru sudah tercatat, tidak ada yang perlu dikejar.",
  milestone_progress: "{done} dari {required} sesi tuntas di Level {level}.",
  improvement: "Tujuh sesi terakhir lebih banyak yang tuntas dibanding tujuh sesi sebelumnya.",
  stable_consistency: "{done} dari 7 sesi terakhir tuntas. Ritmemu stabil.",
};

const fill = (tpl: string, vars: Record<string, number>): string =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

export interface InsightInput {
  /** Calendar from program start through the active session. */
  days: readonly CalendarDay[];
  activeKey: LocalDate;
  levels: readonly LevelProgress[];
}

/** First matching insight in priority order, or null when there is nothing honest to say yet. */
export function pickInsight({ days, activeKey, levels }: InsightInput): Insight | null {
  const closed = days.filter((d) => d.date < activeKey);
  const done = days.filter((d) => d.status === "completed");

  // 1. First completed session, still recent.
  const only = done.length === 1 ? done[0]! : null;
  if (only && diffDays(only.date, activeKey) <= 7) {
    return { type: "first_completion", message: INSIGHT_TEMPLATES.first_completion };
  }

  // 2. Back after at least 3 missed nights in a row (excused nights are skipped).
  const active = days.filter((d) => d.status === "completed" || d.status === "partial");
  const last = active[active.length - 1];
  if (last && diffDays(last.date, activeKey) <= 2) {
    let gap = 0;
    for (let i = days.findIndex((d) => d.date === last.date) - 1; i >= 0; i--) {
      const s = days[i]!.status;
      if (s === "excused") continue;
      if (s === "missed") gap++;
      else break;
    }
    if (gap >= 3) return { type: "return_after_gap", message: INSIGHT_TEMPLATES.return_after_gap };
  }

  // 3. Halfway or one session left on the current level.
  const cur = levels.find((l) => l.isCurrent);
  if (cur && cur.completed < cur.required && cur.completed > 0) {
    const half = Math.ceil(cur.required / 2);
    if (cur.completed === half || cur.completed === cur.required - 1) {
      return {
        type: "milestone_progress",
        message: fill(INSIGHT_TEMPLATES.milestone_progress, {
          done: cur.completed,
          required: cur.required,
          level: cur.level,
        }),
      };
    }
  }

  // 4 and 5 compare the last 7 closed sessions with the 7 before.
  const recent = closed.slice(-7);
  const before = closed.slice(-14, -7);
  const rRecent = completionRate(recent);
  const rBefore = completionRate(before);
  if (rRecent !== null && rBefore !== null && rRecent - rBefore >= 15) {
    return { type: "improvement", message: INSIGHT_TEMPLATES.improvement };
  }
  const doneRecent = recent.filter((d) => d.status === "completed").length;
  if (recent.length === 7 && doneRecent >= 5) {
    return {
      type: "stable_consistency",
      message: fill(INSIGHT_TEMPLATES.stable_consistency, { done: doneRecent }),
    };
  }
  return null;
}
