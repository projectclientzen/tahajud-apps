import type { LevelNumber } from "../config/provisional";
import type { LocalDate } from "../time/tz";
import type { ActivityConfig, AmalanContent, Phase } from "./amalan";
import { getAmalan } from "./amalan";

/** Activity as frozen into a session when it is created (PRD §11.5, §22.3). */
export interface SnapshotActivity {
  id: string;
  key: string;
  phase: Phase;
  type: ActivityConfig["type"];
  kind: ActivityConfig["kind"];
  target: number | null;
  required: boolean;
}

export interface SessionSnapshot {
  sessionKey: LocalDate;
  level: LevelNumber;
  timezone: string;
  regionId: string | null;
  contentVersion: string;
  createdAt: string;
  activities: SnapshotActivity[];
}

export interface SnapshotInput {
  sessionKey: LocalDate;
  level: LevelNumber;
  timezone: string;
  regionId: string | null;
  now: Date;
}

/** Freeze level, timezone, region and requirements. Later config edits never touch an existing snapshot. */
export function createSessionSnapshot(input: SnapshotInput, content: AmalanContent = getAmalan()): SessionSnapshot {
  const cfg = content.levels[input.level];
  return {
    sessionKey: input.sessionKey,
    level: input.level,
    timezone: input.timezone,
    regionId: input.regionId,
    contentVersion: content.contentVersion,
    createdAt: input.now.toISOString(),
    activities: cfg.activities.map((a) => ({
      id: a.id,
      key: a.key,
      phase: a.phase,
      type: a.type,
      kind: a.kind,
      target: a.target,
      required: a.required,
    })),
  };
}
