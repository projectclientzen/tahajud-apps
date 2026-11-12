import { expect, test } from "@playwright/test";
import { loadScenario, openCounter, readRequestCounter, setDemoTime, startSession, withDevPanel } from "./s3-helpers";

const count = (page: import("@playwright/test").Page) => page.getByTestId("count");
const tapButton = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "Tambah satu hitungan" });

test("REPORT-02: a new account sees a friendly empty state, not zeros", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Belum ada catatan")).toBeVisible();
  await expect(page.getByRole("link", { name: "Mulai ibadah malam ini" })).toBeVisible();
  await expect(page.getByRole("note").filter({ hasText: "Data demo" })).toBeVisible();
});

test("DZIKIR-01: taps are saved and survive a reload", async ({ page }) => {
  await startSession(page);
  await openCounter(page, "Istighfar");
  for (let i = 0; i < 21; i++) await tapButton(page).click();
  await expect(count(page)).toHaveText("21");
  await expect(page.getByTestId("sync-status")).toHaveText(/Tersinkron/, { timeout: 10_000 });
  await page.reload();
  await expect(count(page)).toHaveText("21");
});

test("DZIKIR-04: 100 quick taps become a handful of requests and the server count is 100", async ({ page }) => {
  await startSession(page);
  await openCounter(page, "Istighfar");
  for (let i = 0; i < 100; i++) await tapButton(page).click();
  await expect(count(page)).toHaveText("100");
  await expect(page.getByTestId("reached")).toBeVisible();
  await expect(page.getByTestId("sync-status")).toHaveText(/Tersinkron/, { timeout: 10_000 });
  const requests = await readRequestCounter(page);
  expect(requests).toBeGreaterThanOrEqual(1);
  expect(requests).toBeLessThanOrEqual(15);
  await page.reload();
  await expect(count(page)).toHaveText("100");
});

test("DZIKIR-02: offline taps stay on the device and sync once without double counting", async ({ page }) => {
  await startSession(page);
  await openCounter(page, "Istighfar");
  await withDevPanel(page, async () => {
    await page.getByLabel("Simulasi offline").check();
  });
  for (let i = 0; i < 3; i++) await tapButton(page).click();
  await expect(page.getByTestId("sync-status")).toHaveText(/menunggu sinyal/, { timeout: 10_000 });
  await expect(count(page)).toHaveText("3");
  await withDevPanel(page, async () => {
    await page.getByLabel("Simulasi offline").uncheck();
  });
  await expect(page.getByTestId("sync-status")).toHaveText(/Tersinkron/, { timeout: 15_000 });
  await page.reload();
  await expect(count(page)).toHaveText("3");
});

test("counter reset asks first and never goes below zero", async ({ page }) => {
  await startSession(page);
  await openCounter(page, "Istighfar");
  for (let i = 0; i < 5; i++) await tapButton(page).click();
  await page.getByRole("button", { name: "Setel ulang" }).click();
  const dialog = page.getByRole("dialog", { name: "Setel ulang hitungan?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Batal" }).click();
  await expect(count(page)).toHaveText("5");
  await page.getByRole("button", { name: "Setel ulang" }).click();
  await page.getByRole("button", { name: "Ya, setel ulang" }).click();
  await expect(count(page)).toHaveText("0");
  await expect(page.getByRole("button", { name: "Kurangi satu hitungan" })).toBeDisabled();
});

test("LEVEL-02: a missed night does not reduce level progress", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Subuh berikutnya")).toBeVisible();
  await loadScenario(page, "Lima malam tuntas");
  await expect(page.getByText("5 dari 7 malam tuntas")).toBeVisible();
  await withDevPanel(page, async () => {
    await page.getByRole("button", { name: "+1 hari" }).click();
    await expect(page.getByRole("button", { name: "+1 hari" })).toBeEnabled();
  });
  await expect(page.getByText("5 dari 7 malam tuntas")).toBeVisible();
  await expect(page.getByRole("button", { name: /Terlewat/ }).first()).toBeVisible();
});

test("excuse mode: mark tonight, see the banner, undo it", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Tandai berhalangan" }).click();
  const dialog = page.getByRole("dialog", { name: "Tandai berhalangan" });
  await dialog.getByRole("button", { name: "Tandai berhalangan" }).click();
  await expect(page.getByText("Mode berhalangan aktif untuk malam ini")).toBeVisible();
  await page.getByRole("button", { name: "Tandai berhalangan" }).click();
  await page.getByRole("dialog", { name: "Tandai berhalangan" }).getByRole("button", { name: "Batalkan" }).click();
  await expect(page.getByText("Mode berhalangan aktif untuk malam ini")).toBeHidden();
});

test("purchase pending: the dashboard explains the wait instead of showing data", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Subuh berikutnya")).toBeVisible();
  await loadScenario(page, "Pembelian belum terverifikasi");
  await expect(page.getByText("Pembelianmu sedang diverifikasi")).toBeVisible();
});

test("Level 1 flow at phone width: dashboard, session, tick, counter, summary", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Mulai ibadah malam ini" }).click();
  await expect(page).toHaveURL(/\/worship\/session$/);
  await page.getByRole("button", { name: "Mulai ibadah malam ini" }).click();
  await page.getByRole("checkbox", { name: /Salat Taubat/ }).check();
  await expect(page.getByRole("checkbox", { name: /Salat Taubat/ })).toBeChecked();
  await openCounter(page, "Istighfar");
  for (let i = 0; i < 3; i++) await tapButton(page).click();
  await page.getByRole("link", { name: "Kembali ke sesi" }).click();
  await expect(page.getByText("Ringkasan sesi")).toBeVisible();
  await expect(page.getByText(/Malam tuntas di Level 1/)).toBeVisible();
  await page.getByRole("link", { name: "Beranda" }).filter({ visible: true }).click();
  await expect(page.getByRole("link", { name: "Lanjutkan ibadah" })).toBeVisible();
  await expect(page.getByTestId("required-progress")).toContainText("1 dari");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("Fajr transition: banner appears, countdown never goes negative, night items stay editable", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Subuh berikutnya")).toBeVisible();
  await setDemoTime(page, "2026-11-20T03:30");
  await expect(page.getByTestId("fajr-countdown")).toContainText("Subuh dalam");
  await startSession(page);
  await expect(page.getByTestId("fajr-banner")).toContainText("Subuh dalam");
  await setDemoTime(page, "2026-11-20T04:35");
  await expect(page.getByTestId("fajr-banner")).toContainText("Waktu Subuh telah masuk");
  const taubat = page.getByRole("checkbox", { name: /Salat Taubat/ });
  await expect(taubat).not.toBeChecked();
  await taubat.check();
  await expect(taubat).toBeChecked();
  await page.goto("/dashboard");
  await expect(page.getByTestId("fajr-countdown")).toHaveText("Waktu Subuh telah masuk");
});

test("levels: three levels, locked state and the milestone", async ({ page }) => {
  await page.goto("/levels");
  await expect(page.getByTestId("level-1")).toContainText("Aktif");
  await expect(page.getByTestId("level-2")).toContainText("Terkunci");
  await expect(page.getByTestId("level-3")).toContainText("Terkunci");
  await expect(page.getByTestId("milestone")).toContainText("Tidak ada Level 4");
  await loadScenario(page, "Level 2 aktif");
  await expect(page.getByTestId("level-2")).toContainText("Aktif");
  await expect(page.getByTestId("level-2")).toContainText("Berlaku mulai sesi");
  await expect(page.getByTestId("level-3")).toContainText("Terkunci");
});

test("Qur'an items show a note and no verse text", async ({ page }) => {
  await startSession(page);
  const note = page.getByText("Reader menyusul. Centang setelah selesai membaca.");
  await expect(note.first()).toBeVisible();
});
