import { test, type Page } from "@playwright/test";
import { loadScenario } from "./s3-helpers";

/**
 * Review screenshots for U1b into docs/screenshots/u1/. Not part of the default run.
 * Run: U1B_SHOTS=1 U1B_PHASE=before pnpm test:e2e u1b-screens --project=desktop
 * U1B_PHASE is the filename prefix: "u1b-before-..." before fixes, "u1b-..." after.
 */
const PHASE = process.env.U1B_PHASE ?? "after";
const prefix = PHASE === "after" ? "u1b" : `u1b-${PHASE}`;

const ROUTES: { slug: string; path: string; ready: string; viewportOnly?: boolean }[] = [
  { slug: "quran", path: "/quran", ready: "Yasin" },
  { slug: "quran-36", path: "/quran/36", ready: "Progres bacaan", viewportOnly: true },
  { slug: "quran-18", path: "/quran/18", ready: "Progres bacaan", viewportOnly: true },
  { slug: "quran-65", path: "/quran/65", ready: "Progres bacaan" },
  { slug: "reports", path: "/reports", ready: "Tingkat tuntas" },
  { slug: "calendar", path: "/reports/calendar", ready: "Riwayat istiqomah" },
  { slug: "settings", path: "/settings", ready: "Tampilan" },
  { slug: "settings-devices", path: "/settings/devices", ready: "Perangkat ini" },
  { slug: "settings-account", path: "/settings/account", ready: "Unduh data" },
  { slug: "notifications", path: "/notifications", ready: "Pasang alarm manual" },
  { slug: "help", path: "/help", ready: "Referensi amalan" },
  { slug: "profile", path: "/profile", ready: "Zona waktu" },
];

async function shoot(page: Page, name: string, fullPage: boolean) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `docs/screenshots/u1/${prefix}-${name}.png`, fullPage });
}

test.describe("@u1b-screens", () => {
  test.skip(!process.env.U1B_SHOTS, "set U1B_SHOTS=1");
  for (const theme of ["light", "dark"] as const) {
    for (const [vp, viewport] of [
      ["390", { width: 390, height: 844 }],
      ["1280", { width: 1280, height: 800 }],
    ] as const) {
      for (const [state, scenario] of [
        ["isi", "Lima malam tuntas"],
        ["kosong", "Akun baru"],
      ] as const) {
        test(`${vp} ${theme} ${state}`, async ({ browser }, info) => {
          test.skip(info.project.name !== "desktop", "one project is enough");
          test.setTimeout(180_000);
          const ctx = await browser.newContext({
            viewport,
            deviceScaleFactor: 1,
            locale: "id-ID",
            timezoneId: "Asia/Jakarta",
            storageState: "tests/e2e/.auth/demo.json",
          });
          const page = await ctx.newPage();
          await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
          await page.goto("/dashboard");
          await loadScenario(page, scenario);
          const routes = state === "kosong" ? ROUTES.filter((r) => !r.slug.startsWith("settings-")) : ROUTES;
          for (const r of routes) {
            await page.goto(r.path);
            await page.getByText(r.ready).first().waitFor();
            await shoot(page, `${r.slug}-${state}-${vp}-${theme}`, !r.viewportOnly);
          }
          if (state === "isi") {
            await page.goto("/quran/65");
            await page.getByText("Progres bacaan").first().waitFor();
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await shoot(page, `quran-65-akhir-${vp}-${theme}`, false);
            await loadScenario(page, "Offline");
            for (const r of ROUTES.filter((x) => ["quran", "reports", "notifications"].includes(x.slug))) {
              await page.goto(r.path);
              await page.waitForTimeout(600);
              await shoot(page, `${r.slug}-offline-${vp}-${theme}`, true);
            }
          }
          await ctx.close();
        });
      }
    }
  }
});
