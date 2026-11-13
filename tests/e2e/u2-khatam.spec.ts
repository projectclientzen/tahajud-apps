import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { setDemoTime } from "./s3-helpers";

async function start(page: Page, n: number) {
  await page.goto("/quran");
  await page.getByText(`${n}x`, { exact: true }).first().click();
  await expect(page.getByText(`${4 * n} halaman tiap waktu salat`)).toBeVisible();
  await page.getByRole("button", { name: "Mulai target 30 hari" }).click();
  await expect(page.getByTestId("khatam-percent")).toHaveText("0%");
}

test("belum ada target: pilih 1 sampai 5 kali, rencana tampil, target dimulai", async ({ page }) => {
  await page.goto("/quran");
  await expect(page.getByRole("heading", { name: "Mulai target khatam" })).toBeVisible();
  for (const n of [1, 5]) {
    await page.getByText(`${n}x`, { exact: true }).first().click();
    await expect(page.getByText(`${4 * n} halaman tiap waktu salat, ${20 * n} halaman sehari`)).toBeVisible();
  }
  await page.getByRole("button", { name: "Mulai target 30 hari" }).click();
  await expect(page.getByTestId("khatam-percent")).toHaveText("0%");
  await expect(page.getByRole("progressbar", { name: "Progres khatam" })).toHaveAttribute("aria-valuemax", "3020");
  await expect(page.getByText("ke-1 dari 5")).toBeVisible();
  // Five prayer slots, 20 pages each, the first one starting at page 1.
  const slots = page.getByRole("checkbox");
  await expect(slots).toHaveCount(5);
  await expect(page.getByText("20 halaman, mulai halaman 1", { exact: true })).toBeVisible();
  await expect(page.getByText("20 halaman, mulai halaman 21", { exact: true })).toBeVisible();
});

test("centang waktu salat: persen, sisa halaman, dan halaman slot berikutnya ikut bergeser, bertahan setelah reload", async ({ page }) => {
  await start(page, 1);
  await page.getByRole("checkbox", { name: /^Subuh/ }).click();
  await expect(page.getByRole("checkbox", { name: /^Subuh/ })).toBeChecked();
  await expect(page.getByTestId("khatam-left")).toHaveText("600");
  await expect(page.getByTestId("khatam-percent")).toHaveText("0.7%");
  await expect(page.getByText("4 halaman, mulai halaman 5", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Lanjut baca dari halaman 5" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /^Subuh/ })).toBeChecked();
  await expect(page.getByTestId("khatam-left")).toHaveText("600");
  await page.getByRole("checkbox", { name: /^Subuh/ }).click();
  await expect(page.getByTestId("khatam-left")).toHaveText("604");
});

test("tandai terakhir dibaca dari reader, lalu lanjut baca mengarah ke halaman berikutnya", async ({ page }) => {
  await start(page, 1);
  await page.goto("/quran/baca/halaman/50");
  await expect(page.locator("[data-ayah]").first()).toBeVisible();
  await page.getByRole("button", { name: "Tandai sampai halaman 50" }).click();
  await expect(page.getByRole("button", { name: "Terakhir dibaca: halaman 50" })).toBeVisible();
  await page.goto("/quran");
  await expect(page.getByTestId("khatam-left")).toHaveText("554");
  await expect(page.getByRole("link", { name: "Lanjut baca dari halaman 51" })).toBeVisible();
  // From a surah view the same mark is offered at each page marker.
  await page.goto("/quran/baca/surah/1");
  await expect(page.getByRole("button", { name: "Tandai sampai halaman 1" })).toBeVisible();
});

test("ubah target: halaman terbaca tetap, total berubah", async ({ page }) => {
  await start(page, 1);
  await page.getByRole("checkbox", { name: /^Subuh/ }).click();
  await expect(page.getByRole("checkbox", { name: /^Subuh/ })).toBeChecked();
  await page.getByText("Ubah target").click();
  await page.getByText("3x", { exact: true }).last().click();
  await page.getByRole("button", { name: "Simpan target" }).click();
  await expect(page.getByText("Target diubah menjadi 3x khatam.")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Progres khatam" })).toHaveAttribute("aria-valuemax", "1812");
  await expect(page.getByRole("progressbar", { name: "Progres khatam" })).toHaveAttribute("aria-valuenow", "4");
});

test("hari terlewat: tampil sebagai sisa tanpa kalimat menyalahkan, progres tidak direset", async ({ page }) => {
  await start(page, 1);
  await page.getByRole("checkbox", { name: /^Subuh/ }).click();
  await expect(page.getByRole("checkbox", { name: /^Subuh/ })).toBeChecked();
  // Time travel the demo clock three days ahead (WIB wall clock, noon).
  const stamp = new Date(Date.now() + 3 * 86_400_000 + 7 * 3_600_000).toISOString().slice(0, 10) + "T12:00";
  await setDemoTime(page, stamp);
  await page.reload();
  await expect(page.getByTestId("khatam-carried")).toContainText("Sisa dari hari sebelumnya: 56 halaman");
  await expect(page.getByTestId("khatam-carried")).not.toContainText(/terlambat|gagal|malas|kurang/i);
  await expect(page.getByTestId("khatam-left")).toHaveText("600");
});

for (const theme of ["light", "dark"] as const) {
  test(`grafik lingkaran dan checklist: axe dan tanpa luapan horizontal (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
    await start(page, 2);
    await page.getByRole("checkbox", { name: /^Subuh/ }).click();
    await expect(page.getByRole("checkbox", { name: /^Subuh/ })).toBeChecked();
    const ring = page.getByRole("progressbar", { name: "Progres khatam" });
    await expect(ring).toHaveAttribute("aria-valuetext", "8 dari 1208");
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const box of await page.getByRole("checkbox").all()) {
      const b = (await box.locator("xpath=ancestor::label").boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
  });
}
