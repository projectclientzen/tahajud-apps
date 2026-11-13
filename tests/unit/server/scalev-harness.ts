import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadScalevConfig, type ScalevConfig } from "@/server/scalev/config";
import { signBody } from "@/server/scalev/signature";
import { buildHandlers } from "@/server/jobs/handlers";
import { runJobs, type RunSummary } from "@/server/jobs/runner";
import type { Services } from "@/server/jobs/services";
import { ScalevClient } from "@/server/scalev/client";
import { handleScalevWebhook } from "@/server/scalev/intake";
import type { PgliteDb } from "@/server/db/pglite";
import { makeServices } from "./jobs-harness";
import type { FakeScalev } from "./scalev-fake";

export const FIXTURE_DIR = join(__dirname, "..", "..", "fixtures", "scalev");

/** Every fixture says it is not a real Scalev sample. The marker is checked here and stripped before use. */
export function fixture<T = Record<string, unknown>>(name: string): T {
  const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as Record<string, unknown>;
  const mark = raw._fixture as { status?: string } | undefined;
  if (mark?.status !== "NEEDS_VERIFICATION") throw new Error(`${name} is missing the NEEDS_VERIFICATION marker`);
  delete raw._fixture;
  return raw as T;
}

export const SECRET = "whsec_test_" + "a".repeat(32);
export const OLD_SECRET = "whsec_old_" + "b".repeat(32);
export const PAYLOAD_KEY = randomBytes(32).toString("base64");
export const ORDER_ID = "0192f3a0-7b1c-7d2e-8a41-5c6d7e8f9a01";

/** Environment for a configured Scalev. Variants: the numeric id and the SKU of the demo product. */
export function scalevEnv(over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: "test",
    SCALEV_WEBHOOK_SIGNING_SECRET: SECRET,
    SCALEV_PAYLOAD_KEY: PAYLOAD_KEY,
    SCALEV_API_KEY: "sk_test_fake_key_not_real",
    SCALEV_STORE_ID: "2785",
    SCALEV_ALLOWED_VARIANT_IDS: "5550001",
    SESSION_PEPPER: "test-pepper-test-pepper-test-pepper-0123456789",
    TRUSTED_PROXY_HOPS: "1",
    ...over,
  };
}

export const scalevConfig = (over: Record<string, string | undefined> = {}): ScalevConfig =>
  loadScalevConfig(scalevEnv(over));

export function signedRequest(
  body: unknown,
  opts: { secret?: string; headers?: Record<string, string>; raw?: string } = {},
): Request {
  const text = opts.raw ?? (typeof body === "string" ? body : JSON.stringify(body));
  return new Request("http://localhost:3100/api/v1/webhooks/scalev", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-scalev-hmac-sha256": signBody(text, opts.secret ?? SECRET),
      ...opts.headers,
    },
    body: text,
  });
}

export function envelope(
  event: string,
  uniqueId: string,
  data: Record<string, unknown> = { id: ORDER_ID },
): Record<string, unknown> {
  return { event, unique_id: uniqueId, timestamp: "2026-11-13T08:15:42.000000Z", data };
}

// ---------- worker tests ----------
export const PEPPER = "test-pepper-test-pepper-test-pepper-0123456789";

export interface Clock {
  now: Date;
  /** Moves the app clock and the database clock together. */
  set(iso: string): Promise<void>;
  add(ms: number): Promise<void>;
}

export function makeClock(db: PgliteDb, start: string): Clock {
  const c: Clock = {
    now: new Date(start),
    async set(iso) {
      c.now = new Date(iso);
      await db.setNow(iso);
    },
    async add(ms) {
      await c.set(new Date(c.now.getTime() + ms).toISOString());
    },
  };
  return c;
}

export interface WorkerEnv {
  svc: Services;
  clock: Clock;
  logs: { event: string; fields: Record<string, unknown> }[];
  /** Posts a signed webhook through the real intake, then returns its status. */
  webhook(body: unknown): Promise<number>;
  /** Runs every due job (and the jobs they file that are already due). */
  drain(): Promise<RunSummary>;
}

export function makeWorkerEnv(
  db: PgliteDb,
  fake: FakeScalev | null,
  start = "2026-11-13T08:00:00Z",
  over: { env?: Record<string, string | undefined>; client?: Services["scalev"]["client"] } = {},
): WorkerEnv {
  const clock = makeClock(db, start);
  const logs: WorkerEnv["logs"] = [];
  const env = scalevEnv({ SCALEV_API_BASE: fake?.url, ...over.env });
  const config = loadScalevConfig(env);
  const svc = makeServices(db, {
    now: () => clock.now,
    log: (event, fields = {}) => void logs.push({ event, fields }),
    scalev: {
      config,
      client:
        over.client !== undefined
          ? over.client
          : fake
            ? new ScalevClient({ baseUrl: fake.url, apiKey: config.apiKey!, timeoutMs: 2000 })
            : null,
      pepper: PEPPER,
    },
  });
  return {
    svc,
    clock,
    logs,
    async webhook(body) {
      const res = await handleScalevWebhook(signedRequest(body), {
        db: async () => db,
        config,
        env,
        now: () => clock.now,
        log: () => undefined,
      });
      return res.status;
    },
    async drain() {
      const total: RunSummary = { claimed: 0, done: 0, retried: 0, failed: 0, dead: 0, ignored: 0, byType: {} };
      for (let i = 0; i < 20; i++) {
        const r = await runJobs(
          { db, now: () => clock.now, log: svc.log, workerId: "test-worker" },
          buildHandlers(svc),
          { maxJobs: 50 },
        );
        total.claimed += r.claimed;
        total.done += r.done;
        total.retried += r.retried;
        total.failed += r.failed;
        total.dead += r.dead;
        total.ignored += r.ignored;
        for (const [k, v] of Object.entries(r.byType)) total.byType[k] = (total.byType[k] ?? 0) + v;
        if (r.claimed === 0) break;
      }
      return total;
    },
  };
}
