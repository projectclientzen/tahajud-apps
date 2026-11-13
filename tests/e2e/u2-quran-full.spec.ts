import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const surahFile = (n: number) =>
  JSON.parse(readFileSync(join(process.cwd(), "public", "quran", `surah-${String(n).padStart(3, "0")}.json`), "utf8")) as {
    verses: { ayah: number; text: string }[];
  };

test("halaman 1 memuat 7 ayat Al-Fatihah, teks sama dengan file sumber", async ({ page }) => {
  await page.goto("/quran/baca/halaman/1");
  await expect(page.getByRole("heading", { name: "Halaman 1", level: 1 })).toBeVisible();
  await expect(page.locator("[data-ayah]")).toHaveCount(7);
  const src = surahFile(1);
  for (const v of src.verses) {
    expect(await page.locator(`[data-ayah="1:${v.ayah}"]`).textContent()).toBe(v.text);
  }
  await expect(page.getByTestId("quran-attribution")).toContainText("Tanzil");
});

test("halaman 604 memuat tiga surah pendek, tombol berikutnya nonaktif", async ({ page }) => {
  await page.goto("/quran/baca/halaman/604");
  await expect(page.locator("[data-ayah]")).toHaveCount(15);
  await expect(page.getByRole("link", { name: "Berikutnya" })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("link", { name: "Sebelumnya" }).click();
  await expect(page).toHaveURL(/halaman\/603$/);
});

test("surah 2 memuat 286 ayat dengan penanda halaman, basmalah sebagai baris pembuka", async ({ page }) => {
  await page.goto("/quran/baca/surah/2");
  await expect(page.locator("[data-ayah]")).toHaveCount(286);
  await expect(page.getByTestId("basmalah")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Halaman 2", exact: true })).toBeVisible();
});

test("juz 30 terbuka dan berisi surah 78 sampai 114", async ({ page }) => {
  await page.goto("/quran/baca/juz/30");
  await expect(page.getByRole("heading", { name: "Juz 30", level: 1 })).toBeVisible();
  await expect(page.locator('[data-ayah="78:1"]')).toBeVisible();
  await expect(page.locator('[data-ayah="114:6"]')).toHaveCount(1);
});

test("nomor di luar rentang = 404", async ({ page }) => {
  for (const path of ["/quran/baca/halaman/605", "/quran/baca/juz/31", "/quran/baca/surah/115", "/quran/baca/foo/1"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
});

test("daftar surah, juz, dan buka halaman dari tab Al-Qur'an", async ({ page }) => {
  await page.goto("/quran");
  const browse = page.getByRole("region", { name: "Jelajah Al-Qur'an" });
  await expect(browse.getByRole("link", { name: /^114\. An-Naas/ })).toBeVisible();
  await browse.getByRole("button", { name: "Juz" }).click();
  await expect(browse.getByRole("link", { name: /^Juz 30/ })).toBeVisible();
  await browse.getByLabel("Buka halaman").fill("700");
  await browse.getByRole("button", { name: "Buka" }).click();
  await expect(browse.getByRole("alert")).toContainText("1 sampai 604");
  await browse.getByLabel("Buka halaman").fill("50");
  await browse.getByRole("button", { name: "Buka" }).click();
  await expect(page).toHaveURL(/halaman\/50$/);
});

test("service worker tidak menyimpan /api/, hanya berkas statis Qur'an", async ({ page }) => {
  const sw = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  expect(sw).toContain('url.pathname.startsWith("/api/")) return');
  await page.goto("/quran/baca/halaman/1");
  await expect(page.locator("[data-ayah]")).toHaveCount(7);
});
