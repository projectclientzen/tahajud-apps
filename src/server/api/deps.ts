import { loadAuthConfig, type AuthConfig } from "@/server/auth/config";
import type { AuthDeps } from "@/server/auth/service";
import { getDb } from "@/server/db";

export type Deps = AuthDeps;

interface Overrides {
  now: (() => Date) | null;
  cfg: AuthConfig | null;
}
const overrides: Overrides = { now: null, cfg: null };
let memo: { cfg: AuthConfig; dbRef: unknown } | null = null;

/** Everything a request needs, built on first use from the environment. Throws DbConfigError when something is missing. */
export async function getDeps(): Promise<Deps> {
  const db = await getDb();
  if (!memo || memo.dbRef !== db) memo = { cfg: overrides.cfg ?? loadAuthConfig(), dbRef: db };
  return { db, now: overrides.now ?? (() => new Date()), cfg: memo.cfg };
}

/** Tests choose the clock and the auth settings. Call with no argument to restore the defaults. */
export function setDepsForTests(o: Partial<Overrides> = {}): void {
  overrides.now = o.now ?? null;
  overrides.cfg = o.cfg ?? null;
  memo = null;
}
