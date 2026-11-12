import { LEVELS, PROVISIONAL_SETTINGS, type DomainSettings, type LevelNumber } from "../config/provisional";
import type { SessionStatus } from "../content/session-status";
import { addDays, type LocalDate } from "../time/tz";

/** A closed or completed session reduced to what progression needs. */
export interface SessionOutcome {
  sessionKey: LocalDate;
  /** Level frozen in the session snapshot. */
  level: LevelNumber;
  status: SessionStatus;
}

/** Mirrors `user_level_state` (PRD §10.7). Level 1 is unlocked from the program start. */
export interface UserLevelState {
  currentLevel: LevelNumber;
  /** ISO instant when each level was unlocked. */
  unlockedAt: Partial<Record<LevelNumber, string>>;
  /** First session key that uses each level. */
  effectiveFromSessionKey: Partial<Record<LevelNumber, LocalDate>>;
}

export function initialLevelState(programStartDate: LocalDate, now: Date): UserLevelState {
  return {
    currentLevel: 1,
    unlockedAt: { 1: now.toISOString() },
    effectiveFromSessionKey: { 1: programStartDate },
  };
}

export const isUnlocked = (state: UserLevelState, level: LevelNumber): boolean =>
  state.effectiveFromSessionKey[level] !== undefined;

/** Level a session created for `sessionKey` should freeze: highest level already in effect. */
export function levelForSession(state: UserLevelState, sessionKey: LocalDate): LevelNumber {
  let result: LevelNumber = 1;
  for (const l of LEVELS) {
    const from = state.effectiveFromSessionKey[l];
    if (from !== undefined && from <= sessionKey) result = l;
  }
  return result;
}

export function completedAtLevel(outcomes: readonly SessionOutcome[], level: LevelNumber): SessionOutcome[] {
  return outcomes
    .filter((o) => o.level === level && o.status === "completed")
    .sort((a, b) => a.sessionKey.localeCompare(b.sessionKey));
}

export interface LevelProgress {
  level: LevelNumber;
  completed: number;
  required: number;
  /** completed / required, capped at 1. Missed nights never lower it (PRD §10.2). */
  ratio: number;
  unlocked: boolean;
  isCurrent: boolean;
}

export interface ProgressSummary {
  levels: LevelProgress[];
  /** Milestone "Istikamah Journey Completed" (PRD §10.8). User stays at Level 3. */
  journeyCompleted: boolean;
}

export function computeLevelProgress(
  outcomes: readonly SessionOutcome[],
  state: UserLevelState,
  settings: DomainSettings = PROVISIONAL_SETTINGS,
): ProgressSummary {
  const levels = LEVELS.map((level): LevelProgress => {
    const required = settings.levels[level].requiredSuccessfulNights;
    const completed = completedAtLevel(outcomes, level).length;
    return {
      level,
      completed,
      required,
      ratio: Math.min(1, completed / required),
      unlocked: isUnlocked(state, level),
      isCurrent: state.currentLevel === level,
    };
  });
  const l3 = levels[2]!;
  return { levels, journeyCompleted: l3.completed >= l3.required };
}

export interface UnlockResult {
  state: UserLevelState;
  /** Level unlocked by this call, if any. */
  newlyUnlocked: LevelNumber | null;
}

/**
 * Unlock check (PRD §10.7). Monotonic: it only ever adds levels. Corrections that later lower the
 * completed count never lock a level again (SESSION-05). A new level applies from the session after
 * the one currently running, so the running snapshot never changes (LEVEL-04).
 */
export function checkUnlock(
  state: UserLevelState,
  outcomes: readonly SessionOutcome[],
  ctx: { now: Date; activeKey: LocalDate },
  settings: DomainSettings = PROVISIONAL_SETTINGS,
): UnlockResult {
  const next: UserLevelState = {
    currentLevel: state.currentLevel,
    unlockedAt: { ...state.unlockedAt },
    effectiveFromSessionKey: { ...state.effectiveFromSessionKey },
  };
  let newlyUnlocked: LevelNumber | null = null;
  for (const level of [1, 2] as const) {
    const target = (level + 1) as LevelNumber;
    if (isUnlocked(next, target) || !isUnlocked(next, level)) continue;
    const required = settings.levels[level].requiredSuccessfulNights;
    const done = completedAtLevel(outcomes, level);
    const reaching = done[required - 1];
    if (!reaching) continue;
    const base = reaching.sessionKey > ctx.activeKey ? reaching.sessionKey : ctx.activeKey;
    next.unlockedAt[target] = ctx.now.toISOString();
    next.effectiveFromSessionKey[target] = addDays(base, 1);
    newlyUnlocked = target;
  }
  next.currentLevel = levelForSession(next, ctx.activeKey);
  return { state: next, newlyUnlocked };
}
