import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { LIVE_PEPPER, liveAuthSql } from "./tests/e2e/live-auth";

/**
 * Live-mode e2e (T3b, T3c): the real screens talk to the real /api/v1 routes, backed by PostgreSQL in the server process
 * (PGlite). Docker is not available here, so this stands in for the VPS Postgres. Run: `pnpm test:e2e:live`.
 * It builds the app with NEXT_PUBLIC_DATA_MODE=live into .next, so do not run it at the same time as `pnpm test:e2e`.
 */
const PORT = 3199;
// Orders, phone proofs and accounts for the run. Written here because the phone hash needs the server pepper.
const AUTH_FIXTURES = join(tmpdir(), "tt-e2e-auth-fixtures.sql");
writeFileSync(AUTH_FIXTURES, liveAuthSql());

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "{t3[bc],x4}-*.live.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "off", locale: "id-ID", timezoneId: "Asia/Jakarta" },
  projects: [
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 740 }, hasTouch: true } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_DATA_MODE: "live",
      NEXT_PUBLIC_ENABLE_DEV_ROUTES: "false",
      NEXT_TELEMETRY_DISABLED: "1",
      // Test database. The server refuses it unless both flags are set (see src/server/db/index.ts).
      DB_DRIVER: "pglite",
      TAHAJUD_ALLOW_TEST_DB: "true",
      TAHAJUD_TEST_DB_SQL: `tests/e2e/t3b-fixtures.sql,tests/e2e/t3c-fixtures.sql,${AUTH_FIXTURES}`,
      // One trusted proxy: the live specs send X-Forwarded-For themselves, one address per user.
      TRUSTED_PROXY_HOPS: "1",
      // The delete flow is tested here, so self-service deletion is on. Off by default everywhere else.
      ACCOUNT_SELF_DELETE: "true",
      SESSION_PEPPER: LIVE_PEPPER,
    },
  },
});
