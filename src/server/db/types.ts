/** What the API needs from a database. Two real drivers (pg, PGlite) and nothing else knows which one runs. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface Db {
  /**
   * One transaction as the signed-in user: role `authenticated`, JWT claims set, so row level security applies
   * exactly as it does for a Supabase client with that user's token (PRD §16.4).
   */
  asUser<T>(userId: string, fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** One transaction as the backend (`service_role`). Used before a user exists, and for rate limits and devices. */
  asService<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Runs `select <expr> as r` and returns the single value. Parameters are always bound, never concatenated. */
export async function one<T>(q: Queryable, expr: string, params: readonly unknown[] = []): Promise<T> {
  const rows = await q.query<{ r: T }>(`select ${expr} as r`, params);
  return rows[0]!.r;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
