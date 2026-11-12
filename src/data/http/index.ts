import { ApiError } from "../contracts";
import type { DataLayer } from "../repositories";

/** Real client arrives with the /api/v1 backend in S5. Until then every call fails with a clear message. */
const UNAVAILABLE = "Mode live belum tersedia sampai S5. Set NEXT_PUBLIC_DATA_MODE=mock untuk data demo.";

function stub<T extends object>(): T {
  return new Proxy({} as T, {
    get: (_t, prop) => {
      if (prop === "then") return undefined; // not a thenable
      return () => Promise.reject(new ApiError("NOT_AVAILABLE", UNAVAILABLE));
    },
  });
}

export function createHttpDataLayer(): DataLayer {
  return {
    mode: "live",
    access: stub(),
    session: stub(),
    progress: stub(),
    excuse: stub(),
    report: stub(),
    prayer: stub(),
    quran: stub(),
    notifications: stub(),
  };
}
