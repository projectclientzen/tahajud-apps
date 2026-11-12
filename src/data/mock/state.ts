import type { Access, NotificationPreferences, QuranProgress } from "../contracts";
import type { CounterStore } from "@/domain/dhikr/server";
import type { SessionSnapshot } from "@/domain/content/snapshot";
import type { UserLevelState } from "@/domain/progression/progression";

export const SCENARIOS = [
  "new_account",
  "five_nights_completed",
  "level2_active",
  "offline",
  "stale_schedule",
  "purchase_pending",
  "manual_schedule",
  "no_active_access",
  "onboarding_pending",
] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export interface StoredActivity {
  checked: boolean;
  version: number;
}

export interface StoredSession {
  id: string;
  snapshot: SessionSnapshot;
  /** Checklist state. Counter counts live in `counterStore`. */
  activities: Record<string, StoredActivity>;
}

export interface MockProfile {
  displayName: string | null;
  themePref: "system" | "light" | "dark" | "auto-night";
  quranFontSize: number;
  dhikrFontSize: number;
}

export const DEFAULT_PROFILE: MockProfile = {
  displayName: null,
  themePref: "system",
  quranFontSize: 30,
  dhikrFontSize: 28,
};

export interface ManualSchedule {
  timezone: string;
  fajrTime: string;
  maghribTime: string | null;
}

/** Everything the mock "server" remembers for one user. Persisted whole to IndexedDB. */
export interface MockState {
  schemaVersion: 1;
  scenario: ScenarioName;
  access: Access;
  programStartDate: string;
  timezone: string;
  regionId: string | null;
  scheduleMode: "region" | "manual";
  manualSchedule: ManualSchedule | null;
  providerDown: boolean;
  /** ISO instant until which a cached schedule is still valid. Null = no cache. */
  cacheValidUntil: string | null;
  offline: boolean;
  levelState: UserLevelState;
  sessions: Record<string, StoredSession>;
  excusedDates: string[];
  counterStore: CounterStore;
  notificationPrefs: NotificationPreferences;
  quranProgress: Record<string, QuranProgress>;
  /** Frozen dev clock (ISO), or null to follow real time. */
  clockOverride: string | null;
  installPromptDone: boolean;
  /** Absent in states saved before S4a. Filled with defaults on load. */
  profile?: MockProfile;
}

/** Persistence boundary. IndexedDB in the browser, memory in tests. */
export interface StateStorage {
  load(): Promise<MockState | null>;
  save(state: MockState): Promise<void>;
  clear(): Promise<void>;
}
