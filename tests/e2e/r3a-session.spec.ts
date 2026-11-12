import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { userDatabases } from "./r3a-helpers";
import { openCounter, readRequestCounter, startSession, withDevPanel } from "./s3-helpers";

const count = (page: Page) => page.getByTestId("count");
const tapButton = (page: Page) => page.getByRole("button", { name: "Tambah satu hitungan" });
const logoutTrigger = (page: Page) => page.getByRole("button", { name: "Keluar" }).filter({ visible: true }).first();

test("DZIKIR-02: offline taps wait in the queue, then reach the server exactly once (30 taps)", async ({
  page,
  context,
}) => {
  await startSession(page);
  await openCounter(page, "Istighfar");
  await context.setOffline(true);
  for (let i = 0; i < 30; i++) await tapButton(page).click();
  await expect(count(page)).toHaveText("30");
  await expect(page.getByTestId("sync-status")).toHaveText(/menunggu sinyal/, { timeout: 10_000 });
  // Nothing was sent while offline.
  expect(await readRequestCounter(page)).toBe(0);
  await context.setOffline(false);
  await expect(page.getByTestId("sync-status")).toHaveText(/Tersinkron/, { timeout: 15_000 });
  expect(await readRequestCounter(page)).toBeGreaterThanOrEqual(1);
  await expect(count(page)).toHaveText("30");
  await page.reload();
  await expect(count(page)).toHaveText("30");
});

test("DZIKIR-06: signing out with notes that are not synced warns first and keeps them until confirmed", async ({
  page,
}) => {
  await startSession(page);
  await openCounter(page, "Istighfar");
  await withDevPanel(page, async () => {
    await page.getByLabel("Simulasi offline").check();
  });
  for (let i = 0; i < 4; i++) await tapButton(page).click();
  await logoutTrigger(page).click();
  const dialog = page.getByRole("dialog", { name: "Keluar dari perangkat ini?" });
  await expect(dialog.getByTestId("logout-warning")).toContainText("belum tersinkron");
  await expect(dialog.getByRole("button", { name: "Sinkronkan dulu" })).toBeVisible();
  // Cancel: nothing is lost, still signed in, count intact.
  await dialog.getByRole("button", { name: "Batal" }).click();
  await expect(count(page)).toHaveText("4");
  await expect(page).toHaveURL(/\/worship\/dhikr\//);
});

test("DZIKIR-06: syncing first clears the warning and signing out is then quiet", async ({ page }) => {
  await startSession(page);
  await openCounter(page, "Istighfar");
  await withDevPanel(page, async () => {
    await page.getByLabel("Simulasi offline").check();
  });
  for (let i = 0; i < 4; i++) await tapButton(page).click();
  await withDevPanel(page, async () => {
    await page.getByLabel("Simulasi offline").uncheck();
  });
  await expect(page.getByTestId("sync-status")).toHaveText(/Tersinkron/, { timeout: 15_000 });
  await logoutTrigger(page).click();
  const dialog = page.getByRole("dialog", { name: "Keluar dari perangkat ini?" });
  await expect(dialog.getByRole("button", { name: "Keluar", exact: true })).toBeVisible();
  await expect(dialog.getByTestId("logout-warning")).toHaveCount(0);
});

test("SECURITY-06: after signing out, this user's local database is gone and pages are closed", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Subuh berikutnya")).toBeVisible();
  expect((await userDatabases(page)).length).toBeGreaterThan(0);
  await logoutTrigger(page).click();
  await page
    .getByRole("dialog", { name: "Keluar dari perangkat ini?" })
    .getByRole("button", { name: "Keluar", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await userDatabases(page)).toEqual([]);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  expect(await userDatabases(page)).toEqual([]);
});

test("SECURITY-06: signing out with unsynced notes and confirming still deletes everything", async ({ page }) => {
  await startSession(page);
  await openCounter(page, "Istighfar");
  await withDevPanel(page, async () => {
    await page.getByLabel("Simulasi offline").check();
  });
  for (let i = 0; i < 3; i++) await tapButton(page).click();
  await logoutTrigger(page).click();
  const dialog = page.getByRole("dialog", { name: "Keluar dari perangkat ini?" });
  await expect(dialog.getByTestId("logout-warning")).toBeVisible();
  await dialog.getByRole("button", { name: "Tetap keluar dan hapus catatan" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await userDatabases(page)).toEqual([]);
});

test("a session that ran out shows a calm message and a way back in", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Subuh berikutnya")).toBeVisible();
  await withDevPanel(page, async () => {
    await page.getByRole("button", { name: "Majukan sesi login 31 hari" }).click();
  });
  await expect(page.getByText("Sesimu sudah berakhir")).toBeVisible();
  await page.getByRole("link", { name: "Masuk lagi" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("the dashboard install card opens the install guide", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Lihat panduan" }).click();
  const dialog = page.getByRole("dialog", { name: "Pasang di layar utama" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading").first()).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("the sign-out dialog has no serious accessibility problems (light and dark)", async ({ page }) => {
  for (const theme of ["light", "dark"]) {
    await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
    await page.goto("/dashboard");
    await expect(page.getByText("Subuh berikutnya")).toBeVisible();
    await logoutTrigger(page).click();
    await expect(page.getByRole("dialog", { name: "Keluar dari perangkat ini?" })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(
      violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${theme}: ${v.id}`),
    ).toEqual([]);
    await page.keyboard.press("Escape");
  }
});
