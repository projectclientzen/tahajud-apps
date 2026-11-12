import { test } from "@playwright/test";
import { loadScenario, openCounter, startSession } from "./s3-helpers";

// Review screenshots into docs/screenshots/s3. Run: pnpm test:e2e --trace off --grep @s3screens
test.describe("@s3screens", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const [name, viewport] of [
      ["mobile", { width: 390, height: 844 }],
      ["desktop", { width: 1280, height: 800 }],
    ] as const) {
      test(`${name} ${theme}`, async ({ browser }, info) => {
        test.skip(info.project.name !== "desktop", "one run is enough");
        const ctx = await browser.newContext({
          viewport,
          deviceScaleFactor: 2,
          locale: "id-ID",
          timezoneId: "Asia/Jakarta",
        });
        const page = await ctx.newPage();
        await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
        const shot = (what: string) =>
          page.screenshot({ path: `docs/screenshots/s3/${what}-${name}-${theme}.png`, fullPage: true });

        await page.goto("/dashboard");
        await loadScenario(page, "Level 2 aktif");
        await page.getByText("Riwayat istiqomah").waitFor();
        await page.evaluate(() => document.fonts.ready);
        await shot("dashboard");

        await page.goto("/levels");
        await page.getByTestId("level-2").waitFor();
        await shot("levels");

        await page.goto("/worship");
        await page.getByText("rakaat salat malam").waitFor();
        await startSession(page);
        await page.getByRole("checkbox", { name: /Salat Taubat/ }).check();
        await page.getByRole("checkbox", { name: /Salat Taubat/ }).isChecked();
        await shot("session");

        await openCounter(page, "Istighfar");
        for (let i = 0; i < 12; i++) await page.getByRole("button", { name: "Tambah satu hitungan" }).click();
        await page.evaluate(() => document.fonts.ready);
        await shot("counter");
        await ctx.close();
      });
    }
  }
});
