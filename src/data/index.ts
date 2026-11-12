import { createHttpDataLayer } from "./http";
import type { DataLayer } from "./repositories";
import { createMockDataLayer, type CreateMockOptions, type MockDataLayer } from "./mock";

export type DataMode = "mock" | "live";

/** Same rule as src/lib/env.ts: anything except "live" means mock. Mock must show the DEMO DATA badge. */
export function resolveDataMode(value: string | undefined = process.env.NEXT_PUBLIC_DATA_MODE): DataMode {
  return value === "live" ? "live" : "mock";
}

export function createDataLayer(opts: CreateMockOptions & { mode?: DataMode }): DataLayer | MockDataLayer {
  const mode = opts.mode ?? resolveDataMode();
  return mode === "live" ? createHttpDataLayer() : createMockDataLayer(opts);
}

export * from "./contracts";
export type * from "./repositories";
export { createMockDataLayer, type MockDataLayer, type MockDevTools } from "./mock";
export { SCENARIOS, type ScenarioName } from "./mock/state";
