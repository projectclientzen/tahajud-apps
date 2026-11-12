import { test } from "@playwright/test";
import { AUTH_FILE, NO_ACCESS_EMAIL, readOtp, requestCode, signIn } from "./r3a-helpers";
import { openCounter, startSession, withDevPanel } from "./s3-helpers";

const SIGNED_OUT = { cookies: [], origins: [] };

// Review screenshots into docs/screenshots/t1. Run: pnpm test:e2e --trace off --grep @t1screens
test.describe("@t1screens", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const [name, viewport] of [
      ["mobile", { width: 390, height: 844 }],
      ["desktop", { width: 1280, height: 800 }],
    ] as const) {
      test(`${name} ${theme}`, async ({ browser }, info) => {
        test.skip(info.project.name !== "desktop", "one run is enough");
        const base = { viewport, deviceScaleFactor: 2, locale: "id-ID", timezoneId: "Asia/Jakarta" };
        const shotOf = (page: import("@playwright/test").Page) => (what: string) =>
          page.screenshot({ path: `docs/screenshots/t1/${what}-${name}-${theme}.png`, fullPage: true });

        // Signed out: login, code, onboarding, no access.
        const out = await browser.newContext({ ...base, storageState: SIGNED_OUT });
        const a = await out.newPage();
        await a.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
        const shot = shotOf(a);
        await a.goto("/login");
        await a.getByLabel("Email").waitFor();
        await a.evaluate(() => document.fonts.ready);
        await shot("login");
        await requestCode(a, "demo@ngajigaes.test");
        await a.getByText("Tidak menerima kode?").click();
        await shot("verify");
        await a.getByLabel("Kode 6 digit").fill(await readOtp(a, "demo@ngajigaes.test"));
        await a.getByRole("button", { name: "Masuk", exact: true }).click();
        await a.getByRole("button", { name: "Mulai", exact: true }).click();
        await a.getByRole("radio", { name: /Jakarta/ }).check();
        await shot("onboarding-region");
        await a.getByRole("button", { name: "Lanjut" }).click();
        await a.getByTestId("confirm-fajr").waitFor();
        await shot("onboarding-confirm");
        await out.close();

        const none = await browser.newContext({ ...base, storageState: SIGNED_OUT });
        const b = await none.newPage();
        await b.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
        await signIn(b, NO_ACCESS_EMAIL);
        await b.getByText("Belum ada akses aktif untuk email ini").waitFor();
        await shotOf(b)("access-status");
        await none.close();

        // Signed in: counter waiting for signal, sign-out warning.
        const inn = await browser.newContext({ ...base, storageState: AUTH_FILE });
        const c = await inn.newPage();
        await c.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
        await startSession(c);
        await openCounter(c, "Istighfar");
        await inn.setOffline(true);
        for (let i = 0; i < 6; i++) await c.getByRole("button", { name: "Tambah satu hitungan" }).click();
        await c.getByTestId("sync-status").filter({ hasText: "menunggu sinyal" }).waitFor();
        await shotOf(c)("counter-offline");
        await inn.setOffline(false);
        await withDevPanel(c, async () => {
          await c.getByLabel("Simulasi offline").check();
        });
        for (let i = 0; i < 3; i++) await c.getByRole("button", { name: "Tambah satu hitungan" }).click();
        await c.getByRole("button", { name: "Keluar" }).filter({ visible: true }).first().click();
        await c.getByTestId("logout-warning").waitFor();
        await shotOf(c)("logout-warning");
        await inn.close();
      });
    }
  }
});
