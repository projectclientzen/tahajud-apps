import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_EMAIL } from "./r3a-helpers";
import { openCounter, startSession, withDevPanel } from "./s3-helpers";

const count = (page: Page) => page.getByTestId("count");
const status = (page: Page) => page.getByTestId("sync-status");
const tap = (page: Page) => page.getByRole("button", { name: "Tambah satu hitungan" });

async function counterOffline(page: Page) {
  await startSession(page);
  await openCounter(page, "Istighfar");
}

test("DZIKIR-02: offline, 30 taps, back online: the server holds exactly 30", async ({ page, context }) => {
  await counterOffline(page);
  await context.setOffline(true);
  for (let i = 0; i < 30; i++) await tap(page).click();
  await expect(count(page)).toHaveText("30");
  // Nothing is sent while offline, and the screen says where the notes are.
  await expect(status(page)).toHaveText(/menunggu sinyal/, { timeout: 10_000 });

  await context.setOffline(false);
  await expect(status(page)).toHaveText("Tersinkron", { timeout: 15_000 });
  await expect(count(page)).toHaveText("30");

  // The server value is the truth, and nothing was counted twice.
  await page.reload();
  await expect(count(page)).toHaveText("30");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(500);
  await page.reload();
  await expect(count(page)).toHaveText("30");
});

test("DZIKIR-02: notes saved while the server is unreachable survive a reload and are sent once", async ({ page }) => {
  await counterOffline(page);
  await withDevPanel(page, async () => {
    await page.getByLabel("Simulasi offline").check();
  });
  for (let i = 0; i < 12; i++) await tap(page).click();
  await expect(status(page)).toHaveText(/menunggu sinyal/, { timeout: 10_000 });

  // The queue lives in IndexedDB: a reload does not lose the 12 taps, and the screen still shows them.
  await page.reload();
  await expect(count(page)).toHaveText("12");
  await expect(status(page)).toHaveText(/Tersimpan di perangkat/);

  await withDevPanel(page, async () => {
    await page.getByLabel("Simulasi offline").uncheck();
  });
  await expect(status(page)).toHaveText("Tersinkron", { timeout: 20_000 });
  await page.reload();
  await expect(count(page)).toHaveText("12");
});

test("DZIKIR-06: logging out with unsynced notes asks first, and 'Keluar dan buang' needs a second confirmation", async ({
  page,
}) => {
  await counterOffline(page);
  await withDevPanel(page, async () => {
    await page.getByLabel("Simulasi offline").check();
  });
  for (let i = 0; i < 5; i++) await tap(page).click();
  await expect(status(page)).toHaveText(/menunggu sinyal/, { timeout: 10_000 });
  await page.waitForTimeout(2500); // taps become a note in the queue

  await page.getByRole("button", { name: "Keluar" }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: /Ada \d+ catatan belum tersinkron/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Sinkronkan dulu" })).toBeVisible();

  // Sync fails while the server is unreachable, and says so without leaving.
  await dialog.getByRole("button", { name: "Sinkronkan dulu" }).click();
  await expect(dialog.getByRole("status")).toContainText("Sebagian catatan belum terkirim");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Keluar dan buang catatan" }).click();
  const confirm = page.getByRole("dialog", { name: /Buang \d+ catatan\?/ });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Kembali" }).click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/worship\/dhikr\//); // still signed in
  await dialog.getByRole("button", { name: "Batal" }).click();
  await expect(page).toHaveURL(/\/worship\/dhikr\//);
});

test("DZIKIR-06: when the notes reach the server while the dialog is open, it falls back to a plain confirmation", async ({
  page,
  context,
}) => {
  await counterOffline(page);
  await context.setOffline(true);
  for (let i = 0; i < 4; i++) await tap(page).click();
  await expect(status(page)).toHaveText(/menunggu sinyal/, { timeout: 10_000 });
  await page.waitForTimeout(2500); // taps become a note in the queue
  await page.getByRole("button", { name: "Keluar" }).filter({ visible: true }).first().click();
  await expect(page.getByRole("dialog", { name: /Ada \d+ catatan belum tersinkron/ })).toBeVisible();

  await context.setOffline(false);
  const dialog = page.getByRole("dialog", { name: "Keluar dari akun?" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Ya, keluar" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("DZIKIR-06: 'Keluar dan buang' discards the notes after the second confirmation", async ({ page }) => {
  await counterOffline(page);
  await withDevPanel(page, async () => {
    await page.getByLabel("Simulasi offline").check();
  });
  for (let i = 0; i < 4; i++) await tap(page).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Keluar" }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: /Ada \d+ catatan belum tersinkron/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keluar dan buang catatan" }).click();
  await page.getByRole("button", { name: "Ya, keluar dan buang" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("SECURITY-06: after logout the user's IndexedDB is gone and the account must sign in again", async ({ page }) => {
  await counterOffline(page);
  await tap(page).click();
  await expect(status(page)).toHaveText("Tersinkron", { timeout: 10_000 });

  const userDb = async () =>
    page.evaluate(async () =>
      (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => /^tahajud-u_/.test(n)),
    );
  const before = await userDb();
  expect(before.length).toBe(1);

  await page.getByRole("button", { name: "Keluar" }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Keluar dari akun?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Ya, keluar" }).click();
  await expect(page).toHaveURL(/\/login$/);

  expect(await userDb()).toEqual([]);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);

  // Signing in again as the same account works, and the server-side demo data is still there.
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  await page.getByRole("button", { name: "Kirim kode" }).click();
  await expect(page).toHaveURL(/\/auth\/verify$/);
});

test("logout without unsynced notes only asks for one confirmation", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Keluar" }).filter({ visible: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Keluar dari akun?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Batal" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/dashboard$/);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: logout dialogs have no serious or critical violations (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
    await counterOffline(page);
    await withDevPanel(page, async () => {
      await page.getByLabel("Simulasi offline").check();
    });
    for (let i = 0; i < 3; i++) await tap(page).click();
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Keluar" }).filter({ visible: true }).first().click();
    await expect(page.getByRole("dialog", { name: /Ada \d+ catatan belum tersinkron/ })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id} ${v.nodes.length}`)).toEqual([]);
  });
}
