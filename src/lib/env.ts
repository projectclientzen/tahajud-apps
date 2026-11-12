export type DataMode = "mock" | "live";

/** Data source for repositories. Mock is the default until S5 wires the backend. */
export const DATA_MODE: DataMode =
  process.env.NEXT_PUBLIC_DATA_MODE === "live" ? "live" : "mock";

export const IS_DEMO = DATA_MODE === "mock";

/** Dev-only routes (component gallery). Off in production unless explicitly enabled. */
export const DEV_ROUTES_ENABLED =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_DEV_ROUTES === "true";
