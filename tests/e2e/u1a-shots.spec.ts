import { expect, test, type Page } from "@playwright/test";
import { AUTH_FILE, DEMO_EMAIL, NO_ACCESS_EMAIL, PENDING_EMAIL, fillLogin, signIn } from "./r3a-helpers";
import { loadScenario, openCounter, setDemoTime, startSession } from "./s3-helpers";

/**
 * U1a review screenshots. Off unless U1A_PHASE is set, so the normal e2e run stays quiet.
 *   U1A_PHASE=before pnpm test:e2e --trace off --project=desktop u1a-shots
 *   U1A_PHASE=after  pnpm test:e2e --trace off --project=desktop u1a-shots
 * Files go to docs/screenshots/u1/u1a-<phase>-<screen>-<390|1280>-<light|dark>.png
 */
const PHASE = process.env.U1A_PHASE;
const SIZES = [
  ["390", { width: 390, height: 844 }],
  ["1280", { width: 1280, height: 800 }],
] as const;

test.describe("@u1a-shots", () => {
  test.skip(!PHASE, "set U1A_PHASE=before|after to capture");
  test.setTimeout(240_000);

  for (const theme of ["light", "dark"] as const) {
    for (const [size, viewport] of SIZES) {
      const shot = (page: Page, name: string, full = true) =>
        page.screenshot({
          path: `docs/screenshots/u1/u1a-${PHASE}-${name}-${size}-${theme}.png`,
          fullPage: full,
        });
      const settle = async (page: Page) => {
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(250);
      };

      test(`auth ${size} ${theme}`, async ({ browser }) => {
        const ctx = await browser.newContext({
          viewport,
          locale: "id-ID",
          timezoneId: "Asia/Jakarta",
          storageState: { cookies: [], origins: [] },
        });
        const page = await ctx.newPage();
        await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);

        await page.goto("/");
        await settle(page);
        await shot(page, "entry");

        await page.goto("/login");
        await settle(page);
        await shot(page, "login");

        await page.goto("/activate");
        await settle(page);
        await shot(page, "activate");
        await page.goto("/login");
        await fillLogin(page, DEMO_EMAIL, "salah-salah-1");
        await page.locator("#login-error").waitFor();
        await shot(page, "login-error");

        // Access states
        for (const [email, name] of [
          [NO_ACCESS_EMAIL, "access-none"],
          [PENDING_EMAIL, "access-pending"],
        ] as const) {
          const c2 = await browser.newContext({
            viewport,
            locale: "id-ID",
            timezoneId: "Asia/Jakarta",
            storageState: { cookies: [], origins: [] },
          });
          const p2 = await c2.newPage();
          await p2.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
          await signIn(p2, email);
          await p2.waitForURL(/access-status/, { timeout: 15_000 }).catch(() => undefined);
          await settle(p2);
          await shot(p2, name);
          await c2.close();
        }

        // Onboarding (fresh browser, demo user)
        const c3 = await browser.newContext({
          viewport,
          locale: "id-ID",
          timezoneId: "Asia/Jakarta",
          storageState: { cookies: [], origins: [] },
        });
        const p3 = await c3.newPage();
        await p3.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
        await signIn(p3, DEMO_EMAIL);
        await expect(p3).toHaveURL(/\/onboarding$/);
        await settle(p3);
        await shot(p3, "onb-welcome");
        await p3.getByRole("button", { name: "Mulai", exact: true }).click();
        await settle(p3);
        await shot(p3, "onb-region");
        await p3.getByRole("radio", { name: /Jakarta/ }).check();
        await p3.getByRole("button", { name: "Lanjut" }).click();
        await p3.getByTestId("confirm-fajr").waitFor();
        await settle(p3);
        await shot(p3, "onb-confirm");
        await c3.close();
        await ctx.close();
      });

      test(`app ${size} ${theme}`, async ({ browser }) => {
        const ctx = await browser.newContext({
          viewport,
          locale: "id-ID",
          timezoneId: "Asia/Jakarta",
          storageState: AUTH_FILE,
        });
        const page = await ctx.newPage();
        await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);

        await page.goto("/dashboard");
        await page.getByText("Subuh berikutnya").waitFor();
        await settle(page);
        await shot(page, "dash-new");

        await page.goto("/levels");
        await page.getByTestId("level-1").waitFor();
        await settle(page);
        await shot(page, "levels-new");

        await page.goto("/worship");
        await page.getByText("rakaat salat malam").waitFor();
        await settle(page);
        await shot(page, "worship-home");

        await page.goto("/worship/session");
        await page.getByRole("button", { name: "Mulai ibadah malam ini" }).waitFor();
        await settle(page);
        await shot(page, "session-empty");

        await setDemoTime(page, "2026-11-20T03:30");
        await startSession(page);
        await settle(page);
        await shot(page, "session-start");
        await page.getByRole("checkbox", { name: /Salat Taubat/ }).check();

        await openCounter(page, "Istighfar");
        await settle(page);
        await shot(page, "counter-zero", false);
        for (let i = 0; i < 12; i++) await page.getByRole("button", { name: "Tambah satu hitungan" }).click();
        await shot(page, "counter-mid", false);
        for (let i = 0; i < 160; i++) {
          if (await page.getByTestId("reached").isVisible()) break;
          await page.getByRole("button", { name: "Tambah satu hitungan" }).click();
        }
        await shot(page, "counter-reached", false);

        await page.goto("/worship/session");
        await page.getByText("Ringkasan sesi").waitFor();
        await settle(page);
        await shot(page, "session-progress");

        await page.goto("/dashboard");
        await page.getByText("Subuh berikutnya").waitFor();
        await settle(page);
        await shot(page, "dash-3am");

        await setDemoTime(page, "2026-11-20T04:35");
        await page.goto("/worship/session");
        await page.getByTestId("fajr-banner").waitFor();
        await settle(page);
        await shot(page, "session-fajr");
        await page.goto("/dashboard");
        await page.getByText("Subuh berikutnya").waitFor();
        await settle(page);
        await shot(page, "dash-fajr");

        await loadScenario(page, "Lima malam tuntas");
        await page.goto("/dashboard");
        await page.getByText("Riwayat istiqomah").waitFor();
        await settle(page);
        await shot(page, "dash-filled");

        await loadScenario(page, "Level 2 aktif");
        await page.goto("/levels");
        await page.getByTestId("level-2").waitFor();
        await settle(page);
        await shot(page, "levels-l2");

        await loadScenario(page, "Offline");
        await page.goto("/dashboard");
        await settle(page);
        await shot(page, "dash-offline");
        await ctx.close();
      });
    }
  }
});
