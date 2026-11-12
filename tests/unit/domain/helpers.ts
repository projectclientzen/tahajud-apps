import type { ActivityProgress } from "@/domain/session/status";
import type { SessionRecord } from "@/domain/calendar/calendar";
import type { LevelNumber } from "@/domain/config/provisional";
import { createSessionSnapshot } from "@/domain/content/snapshot";

/** Instant from a WIB (+07:00) wall clock string like "2026-11-13 11:59". */
export const wib = (s: string): Date => new Date(s.replace(" ", "T") + ":00+07:00");

export function progressFor(level: LevelNumber, mode: "all" | "none" | "some"): ActivityProgress[] {
  const snap = createSessionSnapshot({
    sessionKey: "2026-11-13",
    level,
    timezone: "Asia/Jakarta",
    regionId: null,
    now: new Date(0),
  });
  return snap.activities.map((a, i) => ({
    id: a.id,
    kind: a.kind,
    required: a.required,
    target: a.target,
    count: mode === "all" && a.kind === "counter" ? (a.target ?? 1) : mode === "some" && i === 3 ? 1 : 0,
    checked: mode === "all" && a.kind === "checklist",
  }));
}

export const record = (sessionKey: string, level: LevelNumber, mode: "all" | "none" | "some"): SessionRecord => ({
  sessionKey,
  level,
  activities: progressFor(level, mode),
});
