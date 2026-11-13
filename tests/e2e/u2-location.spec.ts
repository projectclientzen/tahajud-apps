import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { signIn } from "./r3a-helpers";

// Onboarding starts from a signed-out browser, like a new buyer.
test.use({ storageState: { cookies: [], origins: [] } });

async function toRegionStep(page: Page) {
  await signIn(page);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Mulai", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Wilayahmu" })).toBeVisible();
}

async function allowLocation(context: BrowserContext, latitude: number, longitude: number) {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude, longitude });
}

test("tidak lagi meminta jadwal manual di onboarding", async ({ page }) => {
  await toRegionStep(page);
  await expect(page.getByText("Atur jadwal manual")).toHaveCount(0);
  await expect(page.getByLabel("Jam Subuh")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pakai lokasi otomatis" })).toBeVisible();
});

test("izin lokasi ditolak: pesan ramah, daftar wilayah tetap bisa dipakai sampai selesai", async ({ page, context }) => {
  await context.clearPermissions();
  await page.addInitScript(() => {
    // Headless Chromium has no prompt. Make the refusal explicit so the test does not depend on that default.
    navigator.geolocation.getCurrentPosition = (_ok, err) => err?.({ code: 1, message: "denied" } as GeolocationPositionError);
  });
  await toRegionStep(page);
  await page.getByRole("button", { name: "Pakai lokasi otomatis" }).click();
  await expect(page.getByTestId("auto-note")).toContainText("Izin lokasi tidak diberikan");
  await page.getByRole("radio", { name: /Jakarta/ }).check();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByTestId("confirm-fajr")).toContainText("WIB");
  await page.getByRole("button", { name: "Mulai perjalanan" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("izin diberikan di dekat Makassar: konfirmasi kota, wilayah dan zona waktu terisi, lalu lanjut", async ({ page, context }) => {
  await allowLocation(context, -5.14, 119.42);
  await toRegionStep(page);
  await page.getByRole("button", { name: "Pakai lokasi otomatis" }).click();
  await expect(page.getByTestId("auto-place")).toHaveText("Lokasimu: Contoh: Makassar (WITA). Benar?");
  await page.getByRole("button", { name: "Benar, lanjut" }).click();
  await expect(page.getByTestId("onboarding-step")).toHaveText("Langkah 3 dari 3");
  await expect(page.getByTestId("confirm-fajr")).toContainText("WITA");
  await page.getByRole("button", { name: "Mulai perjalanan" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("kota salah: Bukan, pilih sendiri kembali ke daftar", async ({ page, context }) => {
  await allowLocation(context, -2.55, 140.7);
  await toRegionStep(page);
  await page.getByRole("button", { name: "Pakai lokasi otomatis" }).click();
  await expect(page.getByTestId("auto-place")).toContainText("Jayapura");
  await page.getByRole("button", { name: "Bukan, pilih sendiri" }).click();
  await expect(page.getByTestId("auto-place")).toHaveCount(0);
  await page.getByRole("radio", { name: /Makassar/ }).check();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByTestId("confirm-fajr")).toContainText("WITA");
});

test("lokasi di luar Indonesia: pesan jelas dan pilihan manual", async ({ page, context }) => {
  await allowLocation(context, 51.5, -0.12);
  await toRegionStep(page);
  await page.getByRole("button", { name: "Pakai lokasi otomatis" }).click();
  await expect(page.getByTestId("auto-note")).toContainText("di luar Indonesia");
  await expect(page.getByRole("radio").first()).toBeVisible();
});

test("koordinat tidak tersimpan di perangkat dan tidak dikirim ke jaringan", async ({ page, context }) => {
  const sent: string[] = [];
  page.on("request", (r) => {
    sent.push(`${r.url()} ${r.postData() ?? ""}`);
  });
  await allowLocation(context, -5.1234, 119.4321);
  await toRegionStep(page);
  await page.getByRole("button", { name: "Pakai lokasi otomatis" }).click();
  await page.getByRole("button", { name: "Benar, lanjut" }).click();
  await expect(page.getByTestId("confirm-fajr")).toBeVisible();
  await page.getByRole("button", { name: "Mulai perjalanan" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(sent.filter((x) => /5\.1234|119\.4321|latitude|longitude/i.test(x))).toEqual([]);
  const stored = await page.evaluate(async () => {
    const out: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];
    for (const d of (await indexedDB.databases()) ?? []) {
      if (!d.name) continue;
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const o = indexedDB.open(d.name!);
        o.onsuccess = () => res(o.result);
        o.onerror = () => rej(o.error);
      });
      for (const name of Array.from(db.objectStoreNames)) {
        const rows = await new Promise<unknown[]>((res, rej) => {
          const g = db.transaction(name).objectStore(name).getAll();
          g.onsuccess = () => res(g.result);
          g.onerror = () => rej(g.error);
        });
        out.push(JSON.stringify(rows));
      }
      db.close();
    }
    return out.join("\n");
  });
  expect(stored).not.toMatch(/5\.1234|119\.4321/);
});

for (const theme of ["light", "dark"] as const) {
  test(`langkah wilayah dan konfirmasi lokasi: axe dan tanpa luapan di 320px (${theme})`, async ({ page, context }) => {
    await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
    await page.setViewportSize({ width: 320, height: 640 });
    await allowLocation(context, -5.14, 119.42);
    await toRegionStep(page);
    const check = async (label: string) => {
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${label}: ${v.id}`)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, label).toBeLessThanOrEqual(0);
    };
    await check("region");
    await page.getByRole("button", { name: "Pakai lokasi otomatis" }).click();
    await expect(page.getByTestId("auto-place")).toBeVisible();
    await check("konfirmasi");
  });
}
