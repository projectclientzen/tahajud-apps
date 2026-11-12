import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openCounter, setDemoTime, startSession } from "./s3-helpers";

const tapButton = (page: Page) => page.getByRole("button", { name: "Tambah satu hitungan" });

test.describe("U1a: night flow at 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("counter: the tap button stays put when the target is reached and sits above the bottom nav", async ({
    page,
  }) => {
    await startSession(page);
    await openCounter(page, "Istighfar");
    const before = await tapButton(page).boundingBox();
    expect(before).not.toBeNull();
    expect(before!.width).toBeGreaterThanOrEqual(160);
    expect(before!.height).toBeGreaterThanOrEqual(160);

    const nav = await page.getByRole("navigation", { name: "Navigasi utama" }).boundingBox();
    expect(before!.y + before!.height).toBeLessThanOrEqual(nav!.y);

    for (let i = 0; i < 99; i++) await tapButton(page).click();
    const beforeLast = await tapButton(page).boundingBox();
    await tapButton(page).click();
    await expect(page.getByTestId("reached")).toBeVisible();
    const after = await tapButton(page).boundingBox();
    expect(after).toEqual(beforeLast);
    expect(after).toEqual(before);
    await expect(page.getByTestId("count")).toHaveText("100");
    await expect(page.getByRole("button", { name: "Setel ulang" })).toBeVisible();
  });

  test("session: required progress, phase counts and the next step after the first tick", async ({ page }) => {
    await startSession(page);
    const bar = page.getByRole("progressbar", { name: "Syarat sesi tuntas" });
    await expect(bar).toHaveAttribute("aria-valuenow", "0");
    await expect(page.getByRole("link", { name: /^Lanjut:/ })).toHaveCount(0);

    await page.getByRole("checkbox", { name: /Salat Taubat/ }).check();
    await expect(bar).toHaveAttribute("aria-valuenow", "1");
    const next = page.getByRole("link", { name: /^Lanjut:/ });
    await expect(next).toBeVisible();
    await expect(next).toHaveAttribute("href", /^#act-/);
    await expect(page.getByText(/^1 dari \d+$/).first()).toBeVisible();
  });

  test("Fajr: the banner links to the Subuh activities", async ({ page }) => {
    await page.goto("/dashboard");
    await setDemoTime(page, "2026-11-20T03:30");
    await startSession(page);
    await setDemoTime(page, "2026-11-20T04:35");
    await expect(page.getByTestId("fajr-banner")).toContainText("Waktu Subuh telah masuk");
    const link = page.getByRole("link", { name: "Ke amalan Subuh" });
    await link.click();
    await expect(page).toHaveURL(/#phase-fajr$/);
    await expect(page.getByRole("heading", { name: "Subuh", exact: true })).toBeInViewport();
  });

  test("dashboard header keeps badge and shortcuts on one row", async ({ page }) => {
    await page.goto("/dashboard");
    const badge = await page.getByRole("note").filter({ hasText: "Data demo" }).boundingBox();
    const bell = await page.getByRole("link", { name: "Notifikasi" }).boundingBox();
    expect(Math.abs(badge!.y - bell!.y)).toBeLessThan(24);
    const logout = await page.getByRole("button", { name: "Keluar" }).filter({ visible: true }).first().boundingBox();
    expect(logout!.width).toBeGreaterThanOrEqual(44);
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: counter at target and session with next step (${theme}), no serious or critical`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
    await startSession(page);
    await page.getByRole("checkbox", { name: /Salat Taubat/ }).check();
    await expect(page.getByRole("link", { name: /^Lanjut:/ })).toBeVisible();
    const run = async () =>
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()).violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
    expect(await run()).toEqual([]);
    await openCounter(page, "Istighfar");
    for (let i = 0; i < 100; i++) await tapButton(page).click();
    await expect(page.getByTestId("reached")).toBeVisible();
    expect(await run()).toEqual([]);
  });
}

test("onboarding: the step bar fills as the flow moves on", async ({ browser }) => {
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  const { signIn } = await import("./r3a-helpers");
  await signIn(page);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByTestId("onboarding-step")).toHaveText("Langkah 1 dari 3");
  await page.getByRole("button", { name: "Mulai", exact: true }).click();
  await expect(page.getByTestId("onboarding-step")).toHaveText("Langkah 2 dari 3");
  const radio = page.getByRole("radio", { name: /Jakarta/ });
  await radio.check();
  const row = radio.locator("xpath=ancestor::label");
  await expect(row).toHaveCSS("border-top-width", "1px");
  await ctx.close();
});
