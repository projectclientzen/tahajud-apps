import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "../../scripts/db-lib";

export { createTestDb };

export const DEMO_JKT = "DEMO-JKT";

let n = 0;
export const uuidFor = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

export interface DbError {
  code: string | undefined;
  message: string;
  detail: string | undefined;
}

export type Result<T> = { ok: true; rows: T[] } | { ok: false; error: DbError };

/** Run SQL and return rows or the database error, so a test can assert on what was refused. */
export async function attempt<T = Record<string, unknown>>(
  pg: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<Result<T>> {
  try {
    const r = await pg.query<T>(sql, params);
    return { ok: true, rows: r.rows };
  } catch (e) {
    const err = e as { code?: string; message?: string; detail?: string };
    return { ok: false, error: { code: err.code, message: err.message ?? String(e), detail: err.detail } };
  }
}

export async function rows<T = Record<string, unknown>>(pg: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pg.query<T>(sql, params)).rows;
}

export type Role = "authenticated" | "anon" | "service_role";

/** Act like the API layer: set the JWT claims, switch role, run, then switch back. */
export async function as<T>(pg: PGlite, role: Role, uid: string | null, fn: () => Promise<T>): Promise<T> {
  const claims = uid ? JSON.stringify({ sub: uid, role }) : "";
  await pg.query("select set_config('request.jwt.claims', $1, false)", [claims]);
  await pg.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await pg.exec("reset role");
    await pg.query("select set_config('request.jwt.claims', '', false)");
  }
}

export interface UserOptions {
  email?: string;
  entitlement?: "active" | "pending_verification" | "suspended" | "revoked" | "expired" | "none";
  region?: string | null;
  onboarded?: boolean;
}

/** A user with a profile in the demo Jakarta region and (by default) an active entitlement. */
export async function createUser(pg: PGlite, opts: UserOptions = {}): Promise<string> {
  const i = ++n;
  const id = uuidFor(1000 + i);
  const email = opts.email ?? `user${i}@ngajigaes.test`;
  await pg.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  await pg.query(
    `insert into public.profiles (user_id, email_normalized, region_id, onboarding_completed, program_start_date)
     values ($1, $2, (select id from public.regions where provider_region_code = $3), $4, '2026-11-01')`,
    [id, email, opts.region === undefined ? DEMO_JKT : opts.region, opts.onboarded ?? true],
  );
  const ent = opts.entitlement ?? "active";
  if (ent !== "none") {
    await pg.query(
      `insert into public.access_entitlements (user_id, email_normalized, status, starts_at, expires_at)
       values ($1, $2, $3, '2026-01-01T00:00:00Z', $4)`,
      [id, email, ent, ent === "expired" ? "2026-01-01T00:00:00Z" : null],
    );
  }
  return id;
}

/** ensure_active_session at a chosen moment. Returns the session id and key. */
export async function startSession(pg: PGlite, uid: string, nowIso: string) {
  const r = await rows<{
    s: { session_id: string; session_key: string; level_number: number; created: boolean; timezone: string };
  }>(pg, "select app_private.ensure_active_session($1::uuid, $2::timestamptz) as s", [uid, nowIso]);
  return r[0]!.s;
}

export async function activityId(pg: PGlite, sessionId: string, key: string, phase = "night"): Promise<string> {
  const r = await rows<{ id: string }>(
    pg,
    `select a.id from public.session_activities a
     where a.session_id = $1 and a.phase = $3 and a.activity_config_snapshot ->> 'activity_key' = $2`,
    [sessionId, key, phase],
  );
  if (!r[0]) throw new Error(`no activity ${phase}:${key}`);
  return r[0].id;
}

export interface CounterResult {
  operation_id: string;
  status: "accepted" | "duplicate" | "rejected";
  authoritative_count: number;
  target: number;
  completed: boolean;
  updated_at: string;
  error_code?: string;
}

export async function applyOp(
  pg: PGlite,
  uid: string,
  nowIso: string,
  activity: string,
  opId: string,
  type: "delta" | "set_zero",
  delta: number | null,
  recordedAt: string | null = null,
): Promise<CounterResult> {
  const r = await rows<{ r: CounterResult }>(
    pg,
    "select app_private.apply_counter_operation($1::uuid, $2::timestamptz, $3::uuid, $4, $5, $6::int, $7::timestamptz) as r",
    [uid, nowIso, activity, opId, type, delta, recordedAt],
  );
  return r[0]!.r;
}

/** Finish every required activity of a session through the real functions. */
export async function completeSession(pg: PGlite, uid: string, sessionId: string, nowIso: string): Promise<void> {
  const acts = await rows<{
    id: string;
    kind: string;
    target_count: number | null;
    required_for_completion: boolean;
    version: number;
  }>(
    pg,
    `select id, activity_config_snapshot ->> 'kind' as kind, target_count, required_for_completion, version
     from public.session_activities where session_id = $1 and required_for_completion`,
    [sessionId],
  );
  for (const a of acts) {
    if (a.kind === "checklist") {
      await pg.query("select app_private.set_checklist($1::uuid, $2::timestamptz, $3::uuid, true, $4::int)", [
        uid,
        nowIso,
        a.id,
        a.version,
      ]);
    } else {
      await applyOp(pg, uid, nowIso, a.id, `complete-${a.id}`, "delta", a.target_count ?? 1);
    }
  }
}
