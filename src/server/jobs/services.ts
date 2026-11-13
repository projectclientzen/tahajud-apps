import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { getDb, type Db } from "@/server/db";
import { WebPushSender, vapidFromEnv, type PushSender } from "@/server/push";
import { EquranProvider } from "@/server/prayer/equran-provider";
import type { PrayerTimeProvider } from "@/server/prayer/types";
import { loadJobsConfig, type JobsConfig } from "./config";
import { consoleLogger, type Logger } from "./log";

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

/** Reads DATABASE_URL, VAPID_*, PRAYER_PROVIDER, CRON_SECRET, NOTIF_ALLOW_DEMO_BANK. Missing pieces become a stated problem, not a guess. */
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
