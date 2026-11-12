import type { DataLayer } from "../repositories";
import { MockEngine, type Clock, type EngineOptions } from "./engine";
import { idbStorage, memoryStorage } from "./storage";
import type { ScenarioName } from "./state";

export interface MockDevTools {
  /** Freeze the clock at an ISO instant, or pass null to follow real time again. */
  setNow(iso: string | null): Promise<void>;
  advance(ms: number): Promise<void>;
  now(): Date;
  loadScenario(name: ScenarioName): Promise<void>;
  setOffline(offline: boolean): Promise<void>;
  setProviderDown(down: boolean): Promise<void>;
  /** Delete this user's mock database. */
  reset(): Promise<void>;
  /** Copy of the full mock state, for the S3 dev panel and tests. */
  snapshot: MockEngine["dev_state"];
}

export type MockDataLayer = DataLayer & { mode: "mock"; dev: MockDevTools; engine: MockEngine };

export interface CreateMockOptions {
  userId: string;
  scenario?: ScenarioName;
  /** Defaults to IndexedDB `tahajud-<userId>` in the browser and memory elsewhere. */
  storage?: EngineOptions["storage"];
  clock?: Clock;
}

const realClock: Clock = { now: () => new Date() };

export function createMockDataLayer(opts: CreateMockOptions): MockDataLayer {
  const storage = opts.storage ?? (typeof indexedDB === "undefined" ? memoryStorage() : idbStorage(opts.userId));
  const e = new MockEngine({ userId: opts.userId, scenario: opts.scenario, storage, clock: opts.clock ?? realClock });
  return {
    mode: "mock",
    engine: e,
    access: { getAccess: () => e.getAccess() },
    session: {
      getActiveSession: () => e.getActiveSession(),
      ensureActiveSession: () => e.ensureActiveSession(),
      getSession: (id) => e.getSession(id),
      setChecklist: (id, req) => e.setChecklist(id, req),
      applyCounterOperations: (id, req) => e.applyCounterOperations(id, req),
      getSummary: (id) => e.getSummary(id),
    },
    progress: { getCurrentLevel: () => e.getCurrentLevel(), getLevelProgress: () => e.getLevelProgress() },
    excuse: { addExcuse: (r) => e.addExcuse(r), cancelExcuse: (d) => e.cancelExcuse(d) },
    report: {
      getDashboard: () => e.getDashboard(),
      getReport: (p) => e.getReport(p),
      getCalendar: (f, t) => e.getCalendar(f, t),
      getSessionHistory: () => e.getSessionHistory(),
    },
    prayer: {
      listRegions: () => e.listRegions(),
      getNextFajr: () => e.getNextFajr(),
      getWakePlan: () => e.getWakePlan(),
      setLocation: (r) => e.setLocation(r),
    },
    quran: { getProgress: () => e.getQuranProgress(), putProgress: (s, r) => e.putQuranProgress(s, r) },
    notifications: { getPreferences: () => e.getPreferences(), putPreferences: (p) => e.putPreferences(p) },
    dev: {
      setNow: (iso) => e.dev_setNow(iso),
      advance: (ms) => e.dev_advance(ms),
      now: () => e.now(),
      loadScenario: (n) => e.dev_loadScenario(n),
      setOffline: (v) => e.dev_patch({ offline: v }),
      setProviderDown: (v) => e.dev_patch({ providerDown: v }),
      reset: () => e.dev_reset(),
      snapshot: () => e.dev_state(),
    },
  };
}

export { SCENARIOS, type ScenarioName } from "./state";
