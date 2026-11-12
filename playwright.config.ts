import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  },
  projects: [
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 720 }, hasTouch: true } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `pnpm build && pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { NEXT_PUBLIC_ENABLE_DEV_ROUTES: "true", NEXT_PUBLIC_DATA_MODE: "mock", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
