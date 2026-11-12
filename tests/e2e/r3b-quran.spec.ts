import { expect, test, type Page } from "@playwright/test";
import { setDemoTime } from "./s3-helpers";

test("QURAN-02: bookmark ayat pulih setelah reload dan progres mengikuti", async ({ page }) => {
  await page.goto("/quran/36");
  await expect(page.locator("[data-ayah]")).toHaveCount(83);
  await page.getByRole("button", { name: "Tandai ayat 5 sebagai ayat terakhir" }).click();
  await expect(page.getByRole("button", { name: "Tandai ayat 5 sebagai ayat terakhir" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(page.locator("[data-last-read] [data-ayah]")).toHaveAttribute("data-ayah", "5");
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

test.describe("teks gagal dimuat", () => {
  // The service worker would answer the chunk request itself, so Playwright could not abort it.
  test.use({ serviceWorkers: "block" });

  test("reader tanpa teks (dataset gagal dimuat) menampilkan state jujur dan posisi manual tetap tersimpan", async ({
    page,
  }) => {
    await blockDatasetChunk(page);
    await page.goto("/quran/36");
    await expect(page.getByRole("heading", { name: "Teks ayat belum bisa dimuat" })).toBeVisible();
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
});

test("At-Talaq hanya ayat 2 sampai 3, tanpa basmalah", async ({ page }) => {
  await page.goto("/quran/65");
  await expect(page.getByRole("button", { name: /Tandai ayat \d+ sebagai/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Tandai ayat 2 sebagai ayat terakhir" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tandai ayat 3 sebagai ayat terakhir" })).toBeVisible();
  await expect(page.getByTestId("basmalah")).toHaveCount(0);
});

test("ukuran huruf reader bertahan setelah reload", async ({ page }) => {
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

/** Aborts the lazy chunk that holds the verse text, as a failed or offline download would. */
async function blockDatasetChunk(page: Page) {
  await page.route("**/_next/static/chunks/**", async (route) => {
    const res = await route.fetch();
    const body = await res.text();
    // Only the full dataset (86 KB of text, about 55k characters) is this big and carries the source name.
    if (body.length > 30_000 && body.includes("tanzil-uthmani")) return route.abort();
    return route.fulfill({ response: res, body });
  });
}
