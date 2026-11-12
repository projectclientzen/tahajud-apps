// DEMO DATA: bukan data asli
import { createSessionSnapshot } from "@/domain/content/snapshot";
import { emptyCounterStore, type CounterStore } from "@/domain/dhikr/server";
import { activeSessionKey } from "@/domain/session/keys";
import { initialLevelState } from "@/domain/progression/progression";
import { addDays } from "@/domain/time/tz";
import type { LevelNumber } from "@/domain/config/provisional";
import type { NotificationPreferences } from "../../contracts";
import { DEFAULT_PROFILE, type MockState, type ScenarioName, type StoredSession } from "../state";

export const DEMO_USER_NAME = "Pengguna Demo";
const DEMO_TZ = "Asia/Jakarta";
const DEMO_REGION = "demo-jakarta";

export const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  bedtime: { enabled: true, target_sleep_time: "22:00", offset_minutes: 30 },
  tahajud: { enabled: true },
  fajr: { enabled: true },
  alkahfi: { enabled: true },
  achievement: { enabled: true },
  quiet_hours: { enabled: false, start: "22:00", end: "04:00", allow_worship: true },
};

/** A fully done session at `level`, filling checklists and counters from the real level config. */
function completedSession(
  key: string,
  level: LevelNumber,
  now: Date,
  counters: CounterStore,
  userId: string,
): StoredSession {
  const snapshot = createSessionSnapshot({ sessionKey: key, level, timezone: DEMO_TZ, regionId: DEMO_REGION, now });
  const id = `sess_${key}`;
  const activities: StoredSession["activities"] = {};
  for (const a of snapshot.activities) {
    activities[a.id] = { checked: a.kind === "checklist", version: a.kind === "checklist" ? 1 : 0 };
    if (a.kind === "counter") counters.counts[`${userId}:${key}~${a.id}`] = a.target ?? 1;
  }
  return { id, snapshot, activities };
}

function base(now: Date): MockState {
  const activeKey = activeSessionKey(now, DEMO_TZ);
  return {
    schemaVersion: 1,
    scenario: "new_account",
    access: {
      authenticated: true,
      access_status: "active",
      entitlement_type: "lifetime",
      expires_at: null,
      onboarding_completed: true,
    },
    programStartDate: activeKey,
    timezone: DEMO_TZ,
    regionId: DEMO_REGION,
    scheduleMode: "region",
    manualSchedule: null,
    providerDown: false,
    cacheValidUntil: null,
    offline: false,
    levelState: initialLevelState(activeKey, now),
    sessions: {},
    excusedDates: [],
    counterStore: emptyCounterStore(),
    notificationPrefs: structuredClone(DEFAULT_NOTIFICATION_PREFS),
    quranProgress: {},
    clockOverride: null,
    installPromptDone: false,
    profile: { ...DEFAULT_PROFILE, displayName: DEMO_USER_NAME },
  };
}

function fiveNights(now: Date, userId: string): MockState {
  const s = base(now);
  const active = s.programStartDate;
  s.programStartDate = addDays(active, -5);
  s.levelState = initialLevelState(s.programStartDate, now);
  for (let i = 5; i >= 1; i--) {
    const key = addDays(active, -i);
    s.sessions[key] = completedSession(key, 1, now, s.counterStore, userId);
  }
  s.cacheValidUntil = addDays(active, 20) + "T00:00:00Z";
  return s;
}

function levelTwo(now: Date, userId: string): MockState {
  const s = base(now);
  const active = s.programStartDate;
  s.programStartDate = addDays(active, -9);
  s.levelState = initialLevelState(s.programStartDate, now);
  for (let i = 9; i >= 3; i--) {
    const key = addDays(active, -i);
    s.sessions[key] = completedSession(key, 1, now, s.counterStore, userId); // 7 completed at Level 1
  }
  s.levelState.effectiveFromSessionKey[2] = addDays(active, -2);
  s.levelState.unlockedAt[2] = now.toISOString();
  s.levelState.currentLevel = 2;
  s.sessions[addDays(active, -2)] = completedSession(addDays(active, -2), 2, now, s.counterStore, userId);
  // yesterday: Level 2 session with only the first prayer ticked, so it reads "partial"
  const key = addDays(active, -1);
  const partial = completedSession(key, 2, now, { counts: {}, applied: {} }, userId);
  for (const [id, a] of Object.entries(partial.activities)) a.checked = id === "night:salat_taubat";
  s.sessions[key] = partial;
  s.counterStore.counts[`${userId}:${key}~night:istighfar`] = 40;
  return s;
}

export function buildScenario(name: ScenarioName, now: Date, userId: string): MockState {
  let s: MockState;
  switch (name) {
    case "new_account":
      s = base(now);
      break;
    case "five_nights_completed":
      s = fiveNights(now, userId);
      break;
    case "level2_active":
      s = levelTwo(now, userId);
      break;
    case "offline":
      s = fiveNights(now, userId);
      s.offline = true;
      break;
    case "stale_schedule":
      s = fiveNights(now, userId);
      s.providerDown = true;
      s.cacheValidUntil = new Date(now.getTime() - 24 * 3_600_000).toISOString();
      break;
    case "purchase_pending":
      s = base(now);
      s.access = {
        authenticated: true,
        access_status: "awaiting_order_verification",
        entitlement_type: null,
        expires_at: null,
        onboarding_completed: false,
      };
      break;
    case "no_active_access":
      s = base(now);
      s.access = {
        authenticated: true,
        access_status: "none",
        entitlement_type: null,
        expires_at: null,
        onboarding_completed: false,
      };
      break;
    case "onboarding_pending":
      s = base(now);
      s.access.onboarding_completed = false;
      s.regionId = null; // no region chosen yet: onboarding must set one
      break;
    case "manual_schedule":
      s = base(now);
      s.scheduleMode = "manual";
      s.regionId = null;
      s.timezone = "Asia/Riyadh";
      s.manualSchedule = { timezone: "Asia/Riyadh", fajrTime: "04:45", maghribTime: null };
      s.programStartDate = activeSessionKey(now, "Asia/Riyadh");
      s.levelState = initialLevelState(s.programStartDate, now);
      break;
  }
  s.scenario = name;
  return s;
}
