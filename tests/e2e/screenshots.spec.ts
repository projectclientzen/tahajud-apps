import { test } from "@playwright/test";

// Captures review screenshots into docs/screenshots/s1. Run: pnpm test:e2e --grep @screens
test.describe("@screens", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const [name, viewport] of [
      ["mobile", { width: 390, height: 844 }],
      ["desktop", { width: 1280, height: 800 }],
    ] as const) {
      test(`${name} ${theme}`, async ({ browser }, info) => {
        test.skip(info.project.name !== "desktop", "one run is enough");
        const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: "id-ID" });
        const page = await ctx.newPage();
        await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
        await page.goto("/dev/components");
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `docs/screenshots/s1/gallery-${name}-${theme}.png`, fullPage: true });
        await page.goto("/");
        await page.screenshot({ path: `docs/screenshots/s1/entry-${name}-${theme}.png` });
        await ctx.close();
      });
    }
  }
});
