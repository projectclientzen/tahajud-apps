/**
 * Job worker for a VPS or any long-running Node host.
 *   pnpm worker                  loop forever, one tick every 15 seconds
 *   pnpm worker --once           one tick, then exit (for crontab or tests)
 *   pnpm worker --interval=30    seconds between ticks
 * Reads DATABASE_URL, VAPID_*, PRAYER_PROVIDER, NOTIF_ALLOW_DEMO_BANK from the environment. Nothing is read from the repo.
 * SIGTERM and SIGINT finish the current tick, then exit. Safe to run several copies: each job is claimed by one worker.
 */
import { consoleLogger, createServices, tick } from "../src/server/jobs";

const args = process.argv.slice(2);
const once = args.includes("--once");
const intervalArg = args.find((a) => a.startsWith("--interval="));
const intervalSeconds = intervalArg ? Number(intervalArg.split("=")[1]) : 15;
if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1) {
  console.error("--interval must be a number of seconds, 1 or more");
  process.exit(2);
}
const BUDGET_MS = 25_000;

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    consoleLogger("worker_stopping", { signal: sig });
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<number> {
  const svc = await createServices();
  consoleLogger("worker_started", {
    worker: svc.workerId,
    once,
    interval_seconds: intervalSeconds,
    push_configured: svc.sender !== null,
    prayer_provider: svc.prayerProvider?.name ?? null,
    demo_bank_allowed: svc.config.allowDemoBank,
  });
  let exitCode = 0;
  do {
    try {
      const r = await tick(svc, { deadlineMs: Date.now() + BUDGET_MS });
      consoleLogger("tick", { enqueued: r.enqueued, ...r.run });
    } catch (e) {
      exitCode = 1;
      consoleLogger("tick_failed", { reason: e instanceof Error ? e.message : String(e) });
    }
    if (once || stopping) break;
    await sleep(intervalSeconds * 1000);
  } while (!stopping);
  await svc.db.close();
  return exitCode;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    consoleLogger("worker_failed", { reason: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  },
);
