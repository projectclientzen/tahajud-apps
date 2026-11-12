import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Local database for tests and scripts. Docker is not available in the build container, so this runs
 * PostgreSQL in-process with PGlite (WASM) and a small stand-in for Supabase's `auth` schema and roles.
 * Migrations are the same files `supabase db push` would run.
 */
const ROOT = join(import.meta.dirname, "..", "supabase");

export const MIGRATIONS_DIR = join(ROOT, "migrations");
export const STUB_FILE = join(ROOT, "stubs", "auth_stub.sql");
export const SEED_FILE = join(ROOT, "seed.sql");

export const migrationFiles = (): string[] =>
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

export const readMigration = (file: string): string => readFileSync(join(MIGRATIONS_DIR, file), "utf8");

export async function applyStub(db: PGlite): Promise<void> {
  await db.exec(readFileSync(STUB_FILE, "utf8"));
}

export async function applyMigrations(db: PGlite): Promise<string[]> {
  const files = migrationFiles();
  for (const f of files) await db.exec(readMigration(f));
  return files;
}

export async function applySeed(db: PGlite): Promise<void> {
  await db.exec(readFileSync(SEED_FILE, "utf8"));
}

export interface TestDbOptions {
  seed?: boolean;
}

/** Fresh in-memory database with the stub, all migrations, and (by default) the seed. */
export async function createTestDb(opts: TestDbOptions = {}): Promise<PGlite> {
  const db = new PGlite();
  await applyStub(db);
  await applyMigrations(db);
  if (opts.seed ?? true) await applySeed(db);
  return db;
}
