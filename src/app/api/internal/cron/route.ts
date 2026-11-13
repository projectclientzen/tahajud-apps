import { createHash, timingSafeEqual } from "node:crypto";
import { DbConfigError } from "@/server/db";
import { loadJobsConfig } from "@/server/jobs/config";
import { getServices } from "@/server/jobs/services";
import { tick } from "@/server/jobs/tick";

// Never cached, never prerendered. Node runtime: the job runner uses the database driver and Web Push.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** How long one call keeps picking up jobs. A job that started is allowed to finish. */
const BUDGET_MS = 25_000;

const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } as const;

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: NO_STORE });

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Compares digests, so the time taken does not depend on how many leading characters were right. */
function sameSecret(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

function givenSecret(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth && /^bearer /i.test(auth)) return auth.slice(7).trim();
  return req.headers.get("x-cron-secret")?.trim() ?? null;
}

/**
 * The clock for the job runner, for hosts that cannot keep a process alive: Supabase pg_cron (pg_net), Vercel Cron,
 * or crontab + curl. Call it every minute. It creates the recurring jobs that are due and works the queue for up to
 * 25 seconds. Several callers at the same time are safe (SKIP LOCKED).
 *
 * Auth: CRON_SECRET (at least 32 characters) as `Authorization: Bearer <secret>` (Vercel Cron sends this) or as
 * `x-cron-secret: <secret>`. Without a configured secret the endpoint refuses everything. The secret is never in the repo.
 */
async function run(req: Request): Promise<Response> {
  const { cronSecret } = loadJobsConfig();
  if (!cronSecret) {
    return json(503, { error: { code: "NOT_AVAILABLE", message: "Cron belum dikonfigurasi. Set CRON_SECRET (minimal 32 karakter)." } });
  }
  const given = givenSecret(req);
  if (!given || !sameSecret(given, cronSecret)) {
    return json(401, { error: { code: "UNAUTHENTICATED", message: "Tidak diizinkan." } });
  }
  try {
    const svc = await getServices();
    const result = await tick(svc, { deadlineMs: Date.now() + BUDGET_MS });
    return json(200, { ok: true, ...result });
  } catch (e) {
    if (e instanceof DbConfigError) {
      return json(503, { error: { code: "NOT_AVAILABLE", message: "Server belum dikonfigurasi.", details: { reason: e.message } } });
    }
    // Do not echo internals to the caller. The log line has the reason.
    console.error(JSON.stringify({ scope: "jobs", event: "cron_failed", reason: e instanceof Error ? e.message : String(e) }));
    return json(500, { error: { code: "INTERNAL_ERROR", message: "Terjadi kesalahan di server." } });
  }
}

export const POST = run;
// Vercel Cron only issues GET. The secret check is the same, and a browser or link prefetcher cannot supply it.
export const GET = run;
