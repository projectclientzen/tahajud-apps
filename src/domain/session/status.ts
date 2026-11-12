import type { ActivityKind } from "../content/amalan";
import type { SessionState } from "./state-machine";

/** Progress of one snapshot activity. Counters use `count`, checklists use `checked`. */
export interface ActivityProgress {
  id: string;
  kind: ActivityKind;
  required: boolean;
  target: number | null;
  count: number;
  checked: boolean;
}

export function hasProgress(a: ActivityProgress): boolean {
  return a.kind === "counter" ? a.count > 0 : a.checked;
}

export function isActivityDone(a: ActivityProgress): boolean {
  if (a.kind === "checklist") return a.checked;
  return a.target === null ? a.count > 0 : a.count >= a.target;
}

export interface StatusInput {
  activities: ActivityProgress[];
  /** User marked this date as excused (PRD §10.6). */
  excused: boolean;
  /** Cutoff has passed (PRD §10.4, §10.5). */
  closed: boolean;
}

/**
 * Automatic session status (PRD §10.3-10.6). Never driven by a "finish" button.
 * - excused wins, activities are still recorded for per-activity stats.
 * - completed as soon as every required activity is done.
 * - after cutoff: partial if anything has progress, else missed.
 * - before cutoff: in_progress if anything has progress, else scheduled.
 */
export function computeSessionStatus({ activities, excused, closed }: StatusInput): SessionState {
  if (excused) return "excused";
  const required = activities.filter((a) => a.required);
  if (required.length > 0 && required.every(isActivityDone)) return "completed";
  const anyProgress = activities.some(hasProgress);
  if (closed) return anyProgress ? "partial" : "missed";
  return anyProgress ? "in_progress" : "scheduled";
}
