import { expect, test } from "@playwright/test";
import { loadScenario } from "./s3-helpers";

test("REPORT-02: akun baru melihat Belum ada data, bukan 0%", async ({ page }) => {
  await page.goto("/reports");
  await expect(page.getByTestId("completion-rate")).toHaveText("Belum ada data");
  await expect(page.getByText("0%")).toHaveCount(0);
  await expect(page.getByText("Belum ada data di periode ini.")).toBeVisible();
});

test("laporan: filter 7/30/90 dan statistik per amalan", async ({ page }) => {
  await page.goto("/reports");
  await loadScenario(page, "Lima malam tuntas");
  await expect(page.getByTestId("completion-rate")).toHaveText("100%");
  await expect(page.getByTestId("count-completed")).toHaveText("5");
  await expect(page.getByRole("heading", { name: "Statistik per amalan" })).toBeVisible();
  await expect(page.getByRole("progressbar").first()).toBeVisible();
  await page.getByText("30 hari").click();
  await expect(page.getByTestId("count-completed")).toHaveText("5");
  await page.getByText("90 hari").click();
  await expect(page.getByRole("radio", { name: "90 hari" })).toBeChecked();
});

test("kalender: bulan penuh, navigasi, detail sesi", async ({ page }) => {
  await page.goto("/reports/calendar");
  await loadScenario(page, "Lima malam tuntas");
  const title = page.getByTestId("month-title");
  await expect(title).toHaveText(/\d{4}/);
  await expect(page.getByRole("button", { name: "Bulan berikutnya" })).toBeDisabled();
  const done = page.getByRole("button", { name: /Tuntas$/ }).first();
  await done.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Tuntas");
  await expect(dialog).toContainText("Syarat sesi tuntas");
  await page.keyboard.press("Escape");
});
