import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { adminSql } from "./tests/e2e/admin-fixtures";
import { LIVE_PEPPER } from "./tests/e2e/live-auth";

/**
 * Admin e2e (X2-B): the real /admin screens against the real /api/v1/admin routes and a PGlite database.
 * Run: `pnpm test:e2e:admin`. It builds the app with NEXT_PUBLIC_DATA_MODE=live into .next, so do not run it at the same
 * time as `pnpm test:e2e` or `pnpm test:e2e:live`.
 */
const PORT = 3198;
const FIXTURES = join(tmpdir(), "tt-e2e-admin-fixtures.sql");
writeFileSync(FIXTURES, adminSql());

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "admin-*.live.ts",
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
      DB_DRIVER: "pglite",
      TAHAJUD_ALLOW_TEST_DB: "true",
      TAHAJUD_TEST_DB_SQL: FIXTURES,
      TRUSTED_PROXY_HOPS: "1",
      SESSION_PEPPER: LIVE_PEPPER,
      APP_BASE_URL: `http://localhost:${PORT}`,
    },
  },
});
