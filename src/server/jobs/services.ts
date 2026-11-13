import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { getDb, type Db } from "@/server/db";
import { loadAuthConfig } from "@/server/auth/config";
import { WebPushSender, vapidFromEnv, type PushSender } from "@/server/push";
import { EquranProvider } from "@/server/prayer/equran-provider";
import type { PrayerTimeProvider } from "@/server/prayer/types";
import { ScalevClient, type ScalevApi } from "@/server/scalev/client";
import { loadScalevConfig, type ScalevConfig } from "@/server/scalev/config";
import { loadJobsConfig, type JobsConfig } from "./config";
import { consoleLogger, type Logger } from "./log";

/** Scalev as the worker sees it. A missing piece is a stated problem, so events wait instead of failing for good. */
export interface ScalevRuntime {
  config: ScalevConfig;
  /** Null until SCALEV_API_KEY is set. */
  client: ScalevApi | null;
  /** Secret mixed into the phone hash. Null = SESSION_PEPPER is missing and no order can be provisioned. */
  pepper: string | null;
  problem?: string;
}

/** Everything the handlers talk to. Built once per process from the environment; tests build it by hand. */
export interface Services {
  db: Db;
  now: () => Date;
  log: Logger;
  workerId: string;
  config: JobsConfig;
  sender: PushSender | null;
  senderProblem?: string;
  prayerProvider: PrayerTimeProvider | null;
  prayerProviderProblem?: string;
  scalev: ScalevRuntime;
}

export function makeWorkerId(): string {
  return `${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
}

function buildSender(env: Record<string, string | undefined>): { sender: PushSender | null; problem?: string } {
  try {
    return { sender: new WebPushSender({ vapid: vapidFromEnv(env) }) };
  } catch (e) {
    return { sender: null, problem: e instanceof Error ? e.message : String(e) };
  }
}

function buildScalev(env: Record<string, string | undefined>): ScalevRuntime {
  const problems: string[] = [];
  let config: ScalevConfig;
  try {
    config = loadScalevConfig(env);
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
    config = loadScalevConfig({ ...env, SCALEV_API_BASE: undefined });
  }
  let pepper: string | null = null;
  try {
    pepper = loadAuthConfig(env).pepper;
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }
  const client = config.apiKey && problems.length === 0 ? new ScalevClient({ baseUrl: config.apiBase, apiKey: config.apiKey }) : null;
  if (!config.apiKey) problems.push("SCALEV_API_KEY is not set.");
  return { config, client, pepper, problem: problems.length > 0 ? problems.join(" ") : undefined };
}

/** Reads DATABASE_URL, SCALEV_*, SESSION_PEPPER, VAPID_*, PRAYER_PROVIDER, CRON_SECRET, NOTIF_ALLOW_DEMO_BANK. Missing pieces become a stated problem, not a guess. */
export async function createServices(
  opts: Partial<Services> & { env?: Record<string, string | undefined> } = {},
): Promise<Services> {
  const env = opts.env ?? process.env;
  const config = opts.config ?? loadJobsConfig(env);
  const push = opts.sender !== undefined ? { sender: opts.sender, problem: opts.senderProblem } : buildSender(env);
  let prayerProvider: PrayerTimeProvider | null = opts.prayerProvider ?? null;
  let prayerProviderProblem = opts.prayerProviderProblem;
  if (opts.prayerProvider === undefined) {
    if (config.prayerProvider === "equran") prayerProvider = new EquranProvider();
    else prayerProviderProblem = "PRAYER_PROVIDER is not set. Use PRAYER_PROVIDER=equran after permission to use EQuran.id is confirmed.";
  }
  return {
    db: opts.db ?? (await getDb()),
    now: opts.now ?? (() => new Date()),
    log: opts.log ?? consoleLogger,
    workerId: opts.workerId ?? makeWorkerId(),
    config,
    sender: push.sender,
    senderProblem: push.problem,
    prayerProvider,
    prayerProviderProblem,
    scalev: opts.scalev ?? buildScalev(env),
  };
}

let memo: Promise<Services> | null = null;
let override: Services | null = null;

/** One set of services per server process (the cron endpoint calls this on every request). A failure is not cached. */
export function getServices(): Promise<Services> {
  if (override) return Promise.resolve(override);
  memo ??= createServices().catch((e) => {
    memo = null;
    throw e;
  });
  return memo;
}

/** Tests inject their own services. Pass null to go back to the environment. */
export function setServicesForTests(s: Services | null): void {
  override = s;
  memo = null;
}
