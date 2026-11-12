import { ApiError } from "@/data/contracts";
import { createPgDb } from "./pg";
import type { Db } from "./types";

export * from "./types";
export { mapDbError, HTTP_STATUS } from "./errors";

let current: Promise<Db> | null = null;

/** Why the database cannot be opened, in words a person setting up the server can act on. */
export class DbConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbConfigError";
  }
}

export type DbDriver = "pg" | "pglite";

export function resolveDriver(env: Record<string, string | undefined> = process.env): DbDriver {
  if (env.DB_DRIVER === "pglite") {
    if (env.TAHAJUD_ALLOW_TEST_DB !== "true") {
      throw new DbConfigError(
        "DB_DRIVER=pglite is for tests only. Set TAHAJUD_ALLOW_TEST_DB=true to confirm, or use DATABASE_URL.",
      );
    }
    return "pglite";
  }
  if (!env.DATABASE_URL) {
    throw new DbConfigError("DATABASE_URL is not set. Point it at the Supabase Postgres connection string.");
  }
  return "pg";
}

/** One database per server process. Never reads credentials from anywhere but the environment. */
export function getDb(): Promise<Db> {
  if (!current) {
    current = (async () => {
      const driver = resolveDriver();
      if (driver === "pg") return createPgDb(process.env.DATABASE_URL!);
      const { createPgliteDb } = await import("./pglite");
      const extra = process.env.TAHAJUD_TEST_DB_SQL;
      return createPgliteDb({ extraSqlFiles: extra ? extra.split(",") : [] });
    })().catch((e) => {
      current = null; // try again on the next request instead of caching the failure
      throw e;
    });
  }
  return current;
}

/** Tests inject their own database. Pass null to forget it. */
export function setDbForTests(db: Db | null): void {
  current = db ? Promise.resolve(db) : null;
}

export function configErrorToApi(e: DbConfigError): ApiError {
  return new ApiError("NOT_AVAILABLE", "Server belum dikonfigurasi. Hubungi admin.", { reason: e.message });
}
