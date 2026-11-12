import { expect, test } from "@playwright/test";

test("NOTIF-03: browser tanpa push menampilkan panduan alarm manual", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { PushManager?: unknown }).PushManager;
  });
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Browser ini belum mendukung notifikasi push" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pasang alarm manual" })).toBeVisible();
  await expect(page.getByTestId("manual-wake")).toContainText(/\d{2}\.\d{2} WIB/);
  await expect(page.getByRole("button", { name: "Aktifkan pengingat" })).toHaveCount(0);
});

test("browser dengan push: tombol aktivasi tampil dan riwayat demo terlihat", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Notification, "permission", { get: () => "default" }));
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Aktifkan pengingat" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Riwayat" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Pengingat tidur" })).toBeVisible();
});

test("iOS di luar aplikasi terpasang melihat panduan install", async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
  });
  const page = await ctx.newPage();
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Pasang aplikasi dulu untuk mengaktifkan pengingat" })).toBeVisible();
  await ctx.close();
});

test("izin notifikasi ditolak: panduan izin dan alarm manual tetap ada", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Notification, "permission", { get: () => "denied" }));
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "Izin belum diberikan" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pasang alarm manual" })).toBeVisible();
});
