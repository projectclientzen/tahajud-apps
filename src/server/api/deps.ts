import { loadAuthConfig, type AuthConfig } from "@/server/auth/config";
import { createProvider, type OtpProvider } from "@/server/auth/providers";
import type { AuthDeps } from "@/server/auth/service";
import { getDb } from "@/server/db";

export type Deps = AuthDeps;

interface Overrides {
  now: (() => Date) | null;
  cfg: AuthConfig | null;
  provider: OtpProvider | null;
}
const overrides: Overrides = { now: null, cfg: null, provider: null };
let memo: { cfg: AuthConfig; provider: OtpProvider; dbRef: unknown } | null = null;

/** Everything a request needs, built on first use from the environment. Throws DbConfigError when something is missing. */
export async function getDeps(): Promise<Deps> {
  const db = await getDb();
  if (!memo || memo.dbRef !== db) {
    const cfg = overrides.cfg ?? loadAuthConfig();
    memo = { cfg, provider: overrides.provider ?? createProvider(db, cfg), dbRef: db };
  }
  return { db, now: overrides.now ?? (() => new Date()), cfg: memo.cfg, provider: memo.provider };
}

/** Tests choose the clock, the auth settings, and the provider. Call with no argument to restore the defaults. */
export function setDepsForTests(o: Partial<Overrides> = {}): void {
  overrides.now = o.now ?? null;
  overrides.cfg = o.cfg ?? null;
  overrides.provider = o.provider ?? null;
  memo = null;
}
