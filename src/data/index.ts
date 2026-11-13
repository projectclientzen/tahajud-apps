import { createHttpAuthRepository, createHttpDataLayer } from "./http";
import type { AuthRepository, DataLayer } from "./repositories";
import {
  createMockAuth,
  createMockDataLayer,
  type CreateMockAuthOptions,
  type CreateMockOptions,
  type MockAuthLayer,
  type MockDataLayer,
} from "./mock";

export type DataMode = "mock" | "live";

/** Same rule as src/lib/env.ts: anything except "live" means mock. Mock must show the DEMO DATA badge. */
export function resolveDataMode(value: string | undefined = process.env.NEXT_PUBLIC_DATA_MODE): DataMode {
  return value === "live" ? "live" : "mock";
}

export function createDataLayer(opts: CreateMockOptions & { mode?: DataMode }): DataLayer | MockDataLayer {
  const mode = opts.mode ?? resolveDataMode();
  return mode === "live" ? createHttpDataLayer() : createMockDataLayer(opts);
}

/** Sign-in repository. Mock mode simulates activation, passwords and sessions in the browser (demo only). Live mode calls /api/v1. */
export function createAuthLayer(
  opts: CreateMockAuthOptions & { mode?: DataMode } = {},
): AuthRepository | MockAuthLayer {
  const mode = opts.mode ?? resolveDataMode();
  return mode === "live" ? createHttpAuthRepository() : createMockAuth(opts);
}

export * from "./contracts";
export type * from "./repositories";
export {
  createMockAuth,
  createMockDataLayer,
  AUTH_SCENARIOS,
  type AuthScenarioName,
  type MockAuthDevTools,
  type MockAuthLayer,
  type MockDataLayer,
  type MockDevTools,
} from "./mock";
export { purgeUserDb } from "./user-db";
export { SCENARIOS, type ScenarioName } from "./mock/state";
