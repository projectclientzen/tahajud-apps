import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { seedSignedIn } from "./r3b-fixtures";

test("tema dan ukuran huruf Arab bertahan setelah reload", async ({ page }) => {
  await page.goto("/settings");
  await page.getByText("Gelap", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Perbesar Huruf Al-Qur'an" }).click();
  await page.getByRole("button", { name: "Perbesar Huruf dzikir" }).click();
  await expect(page.getByTestId("font-quran")).toHaveText("32 px");
  await expect(page.getByTestId("font-dhikr")).toHaveText("30 px");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("radio", { name: "Gelap", exact: true })).toBeChecked();
  await expect(page.getByTestId("font-quran")).toHaveText("32 px");
  await expect(page.getByTestId("font-dhikr")).toHaveText("30 px");
});

test("jam tenang dan durasi ibadah bertahan setelah reload", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("switch", { name: /Jam tenang/ }).check();
  await page.getByLabel("Mulai").fill("21:15");
  await page.getByLabel("Selesai").fill("03:45");
  await page.getByRole("button", { name: "Simpan notifikasi" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Tersimpan." }).first()).toBeVisible();

  await page.getByLabel("Durasi Level 1 (menit)").fill("90");
  await page.getByLabel("Waktu persiapan (menit)").fill("15");
  await page.getByLabel("Target tidur", { exact: true }).fill("23:00");
  await expect(page.getByTestId("wake-preview")).toBeVisible();
  await page.getByRole("button", { name: "Simpan jam bangun" }).click();
  // Wait for the save to finish before reloading, or the reload can cancel it.
  await expect(page.getByRole("status").filter({ hasText: "Tersimpan." })).toHaveCount(2);

  await page.reload();
  await expect(page.getByLabel("Mulai")).toHaveValue("21:15");
  await expect(page.getByLabel("Selesai")).toHaveValue("03:45");
  await expect(page.getByLabel("Durasi Level 1 (menit)")).toHaveValue("90");
  await expect(page.getByLabel("Waktu persiapan (menit)")).toHaveValue("15");
  await expect(page.getByLabel("Target tidur", { exact: true })).toHaveValue("23:00");
});

test("jadwal manual tersimpan dan bertahan setelah reload", async ({ page }) => {
  await page.goto("/settings");
  await page.getByText("Atur manual").click();
  await page.getByLabel("Jam Subuh").fill("04:41");
  await page.getByRole("button", { name: "Simpan wilayah" }).click();
  await expect(page.getByText(/Tersimpan\. .*Diatur manual/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: "Atur manual" })).toBeChecked();
  await expect(page.getByLabel("Jam Subuh")).toHaveValue("04:41");
});

test("/settings/devices: daftar perangkat, keluarkan perangkat lain", async ({ page }) => {
  await seedSignedIn(page);
  await page.goto("/settings/devices");
  await expect(page.getByText("Perangkat ini", { exact: true })).toBeVisible();
  await expect(page.getByText("Contoh: iPhone Safari")).toBeVisible();
  await expect(page.getByRole("button", { name: /Keluarkan Perangkat ini/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Keluarkan Contoh: iPhone Safari" }).click();
  await page.getByRole("button", { name: "Ya, keluarkan" }).click();
  await expect(page.getByText("Contoh: iPhone Safari")).toHaveCount(0);
  await expect(page.getByText("Contoh: Laptop Firefox")).toBeVisible();
});

test.describe("tanpa sesi login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("/settings/devices mengarahkan ke /login, bukan menampilkan data", async ({ page }) => {
    await page.goto("/settings/devices");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("Perangkat aktif")).toHaveCount(0);
  });
});

test("/settings/account: unduh JSON tetap ada, hapus akun mandiri tidak ada dan diganti catatan CS", async ({ page }) => {
  await seedSignedIn(page);
  await page.goto("/settings/account");
  await expect(page.getByText("Masuk sebagai demo@ngajigaes.test")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Unduh data (JSON)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^tahajud-data-\d{4}-\d{2}-\d{2}\.json$/);
  const json = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(json).toHaveProperty("profile");
  expect(json).toHaveProperty("notification_preferences");
  expect(json.demo).toBe(true);

  // No self-service deletion for now: access follows the purchase email. The note points to CS instead.
  await expect(page.getByRole("button", { name: /Hapus akun/ })).toHaveCount(0);
  await expect(page.getByLabel("Email akun")).toHaveCount(0);
  await expect(page.getByText("Akses mengikuti email pembelianmu")).toBeVisible();
  await expect(page.getByText("Kirim permintaan ke CS")).toBeVisible();
  // The build has no NEXT_PUBLIC_CS_WHATSAPP, so no WhatsApp button either.
  await expect(page.getByRole("link", { name: "Chat CS di WhatsApp" })).toHaveCount(0);
});
