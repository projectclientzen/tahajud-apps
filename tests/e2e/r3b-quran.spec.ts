import { expect, test } from "@playwright/test";
import { QURAN_FIXTURE, withQuranFixture } from "./r3b-fixtures";
import { setDemoTime } from "./s3-helpers";

test("QURAN-02: bookmark ayat pulih setelah reload (teks uji, bukan Qur'an)", async ({ page }) => {
  await withQuranFixture(page);
  await page.goto("/quran/36");
  await expect(page.getByRole("note").filter({ hasText: "Teks uji" })).toContainText("bukan Al-Qur'an");
  await page.getByRole("button", { name: "Tandai ayat 5 sebagai ayat terakhir" }).click();
  await expect(page.getByRole("button", { name: "Tandai ayat 5 sebagai ayat terakhir" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(page.locator("[data-last-read]")).toContainText("Ayat uji 5");
  await expect(page.getByRole("progressbar", { name: "Progres bacaan" })).toHaveAttribute(
    "aria-valuetext",
    "Ayat 5 dari 83",
  );
  await page.getByRole("button", { name: "Tandai selesai" }).click();
  await expect(page.getByRole("progressbar", { name: "Progres bacaan" })).toHaveAttribute(
    "aria-valuetext",
    "Ayat 83 dari 83",
  );
});

test("reader tanpa dataset menampilkan state jujur dan posisi manual tetap tersimpan", async ({ page }) => {
  await page.goto("/quran/36");
  await expect(page.getByRole("heading", { name: "Dataset Al-Qur'an belum diimport" })).toBeVisible();
  await expect(page.locator(".arabic")).toHaveCount(0);
  await page.getByLabel("Ayat terakhir dibaca").fill("200");
  await page.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Isi nomor ayat 1 sampai 83")).toBeVisible();
  await page.getByLabel("Ayat terakhir dibaca").fill("12");
  await page.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ayat terakhir dicatat: 12" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("progressbar", { name: "Progres bacaan" })).toHaveAttribute(
    "aria-valuetext",
    "Ayat 12 dari 83",
  );
  await page.goto("/quran");
  await expect(page.getByRole("link", { name: /Yasin/ })).toContainText("12 dari 83 ayat");
  await expect(page.getByRole("link")).toContainText(
    ["Yasin", "Al-Waqi'ah", "Al-Mulk", "Ar-Rahman", "Al-Kahfi", "At-Talaq"],
    { useInnerText: true },
  );
});

test("At-Talaq hanya ayat 2 sampai 3", async ({ page }) => {
  await withQuranFixture(page);
  await page.goto("/quran/65");
  await expect(page.getByRole("button", { name: /Tandai ayat \d+ sebagai/ })).toHaveCount(QURAN_FIXTURE[65].length);
  await expect(page.getByText("Ayat uji 2")).toBeVisible();
});

test("ukuran huruf reader bertahan setelah reload", async ({ page }) => {
  await withQuranFixture(page);
  await page.goto("/quran/36");
  const size = page.getByTestId("reader-font");
  await expect(size).toHaveText("30 px");
  await page.getByRole("button", { name: "Perbesar huruf" }).click();
  await expect(size).toHaveText("32 px");
  await page.reload();
  await expect(size).toHaveText("32 px");
  await page.getByRole("button", { name: "Mode malam" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("badge Bacaan Jumat mengikuti jendela Al-Kahfi", async ({ page }) => {
  await page.goto("/quran");
  await setDemoTime(page, "2026-11-12T19:00"); // Kamis malam, setelah Maghrib
  await expect(page.getByText("Bacaan Jumat")).toBeVisible();
  await setDemoTime(page, "2026-11-14T10:00"); // Sabtu
  await expect(page.getByText("Bacaan Jumat")).toHaveCount(0);
});

test("surah di luar enam bacaan menampilkan 404", async ({ page }) => {
  const res = await page.goto("/quran/1");
  expect(res?.status()).toBe(404);
});
