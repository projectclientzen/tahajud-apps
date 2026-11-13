import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Db, Queryable } from "./types";

/**
 * PostgreSQL inside the Node process (PGlite). For tests and for running the live app without Docker.
 * It is NOT a production database: it forgets everything on restart, and it stands in for Supabase Auth with
 * the stub in supabase/stubs/auth_stub.sql. `getDb()` refuses it unless TAHAJUD_ALLOW_TEST_DB=true.
 */
export interface PgliteDb extends Db {
  /** Move the database clock (tests only). Null follows real time again. */
  setNow(iso: string | null): Promise<void>;
  /** Run SQL as the database owner, bypassing every role. Tests use it to prepare data. */
  exec(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
}

export interface PgliteOptions {
  /** Defaults to the repository's supabase folder under the current directory. */
  supabaseDir?: string;
  /** Extra SQL files run after the seed (test fixtures). */
  extraSqlFiles?: string[];
  seed?: boolean;
}

const CLOCK_OVERRIDE = `
create or replace function app_private.server_now() returns timestamptz
language sql stable set search_path = '' as $$
  select coalesce(nullif(pg_catalog.current_setting('tt.test_now', true), '')::timestamptz, pg_catalog.now())
$$;
grant execute on function app_private.server_now() to service_role;
`;

export async function createPgliteDb(opts: PgliteOptions = {}): Promise<PgliteDb> {
  // webpackIgnore: PGlite loads WASM files by path, which a bundler would break. Node loads it directly.
  const { PGlite } = (await import(
    /* webpackIgnore: true */ "@electric-sql/pglite"
  )) as typeof import("@electric-sql/pglite");
  const dir = opts.supabaseDir ?? join(process.cwd(), "supabase");
  const pg = new PGlite();
  await pg.exec(readFileSync(join(dir, "stubs", "auth_stub.sql"), "utf8"));
  for (const f of readdirSync(join(dir, "migrations"))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    await pg.exec(readFileSync(join(dir, "migrations", f), "utf8"));
  }
  if (opts.seed ?? true) await pg.exec(readFileSync(join(dir, "seed.sql"), "utf8"));
  await pg.exec(CLOCK_OVERRIDE);
  for (const f of opts.extraSqlFiles ?? []) await pg.exec(readFileSync(f, "utf8"));

  async function run<T>(role: "authenticated" | "service_role", uid: string | null, fn: (q: Queryable) => Promise<T>) {
    return pg.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        uid ? JSON.stringify({ sub: uid, role }) : "",
      ]);
      await tx.exec(`set local role ${role}`);
      return fn({
        query: async <R>(sql: string, params?: readonly unknown[]) =>
          (await tx.query<R>(sql, params as unknown[] | undefined)).rows,
      });
    });
  }

  return {
    asUser: (uid, fn) => run("authenticated", uid, fn),
    asService: (fn) => run("service_role", null, fn),
    close: () => pg.close(),
    setNow: async (iso) => {
      await pg.query("select set_config('tt.test_now', $1, false)", [iso ?? ""]);
    },
    exec: async (sql, params) => (await pg.query<Record<string, unknown>>(sql, params as unknown[] | undefined)).rows,
  };
}
