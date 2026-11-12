import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Live-mode e2e (T3b): the real screens talk to the real /api/v1 routes, backed by PostgreSQL in the server process
 * (PGlite). Docker is not available here, so this stands in for Supabase. Run: `pnpm test:e2e:live`.
 * It builds the app with NEXT_PUBLIC_DATA_MODE=live into .next, so do not run it at the same time as `pnpm test:e2e`.
 */
const PORT = 3199;
export const MAIL_DIR = join(tmpdir(), "tt-e2e-mail");

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "t3b-*.live.ts",
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
      // Test database and local mail. The server refuses these unless all flags are set (see src/server/auth/config.ts).
      DB_DRIVER: "pglite",
      TAHAJUD_ALLOW_TEST_DB: "true",
      AUTH_PROVIDER: "local",
      TAHAJUD_ALLOW_LOCAL_AUTH: "true",
      TAHAJUD_MAIL_DIR: MAIL_DIR,
      TAHAJUD_TEST_DB_SQL: "tests/e2e/t3b-fixtures.sql",
      SESSION_PEPPER: "e2e-pepper-e2e-pepper-e2e-pepper-123456",
    },
  },
});
