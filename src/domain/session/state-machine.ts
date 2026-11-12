import type { SessionStatus } from "../content/session-status";

/** Stored session states (PRD §11.3). `missed` is derived on read but is a valid state. */
export const SESSION_STATES = ["scheduled", "in_progress", "completed", "partial", "missed", "excused"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

const FINAL: readonly SessionState[] = ["completed", "partial", "missed", "excused"];
export const isFinalState = (s: SessionState): boolean => FINAL.includes(s);

/** Transitions allowed at any time (PRD §11.3 diagram). */
const NORMAL: Record<SessionState, readonly SessionState[]> = {
  scheduled: ["in_progress", "completed", "missed", "excused"],
  in_progress: ["completed", "partial", "excused"],
  completed: [],
  partial: [],
  missed: [],
  excused: [],
};

export type TransitionResult = { ok: true; to: SessionState } | { ok: false; reason: "illegal" | "window_closed" };

/**
 * Legal transition check. Leaving a final state is a correction: only inside the correction window,
 * and the caller must write a session_audit_logs entry (PRD §11.3).
 * Excuse can be revoked (excused -> scheduled) in the window too (PRD §10.6).
 */
export function transition(
  from: SessionState,
  to: SessionState,
  opts: { inCorrectionWindow: boolean },
): TransitionResult {
  if (from === to) return { ok: false, reason: "illegal" };
  if (NORMAL[from].includes(to)) return { ok: true, to };
  if (isFinalState(from)) {
    if (!opts.inCorrectionWindow) return { ok: false, reason: "window_closed" };
    // A correction may land on any other state except back to a final-from-nothing path.
    return { ok: true, to };
  }
  return { ok: false, reason: "illegal" };
}

/** Display status for lists and calendar. Sessions not yet closed read as "upcoming". */
export function toDisplayStatus(state: SessionState): SessionStatus {
  return state === "scheduled" || state === "in_progress" ? "upcoming" : state;
}
