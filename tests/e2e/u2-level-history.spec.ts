import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { loadScenario } from "./s3-helpers";

test("akun baru: hanya Level 1 yang bisa dibuka, level lain terkunci tanpa tautan", async ({ page }) => {
  await page.goto("/worship");
  const section = page.getByRole("region", { name: "Riwayat level" });
  await expect(section.getByRole("link", { name: /Level 1/ })).toHaveAttribute("href", "/worship/level/1");
  await expect(section.getByRole("link")).toHaveCount(1);
  await expect(section.getByText("Terkunci")).toHaveCount(2);
});

test("Level 1 terbuka hanya baca: rekap catatan dan isi amalan", async ({ page }) => {
  await page.goto("/worship/level/1");
  await expect(page.getByRole("heading", { level: 1, name: /Level 1/ })).toBeVisible();
  await expect(page.getByTestId("level-recap")).toContainText("Malam tuntas");
  await expect(page.getByRole("heading", { name: "Isi amalan" })).toBeVisible();
  await expect(page.locator(".arabic").first()).toBeVisible();
  // Read only: no checkbox, counter or save control.
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Simpan|Tandai|Mulai/ })).toHaveCount(0);
});

test("level yang belum dicapai tidak bisa dipratinjau lewat URL", async ({ page }) => {
  await page.goto("/worship/level/2");
  await expect(page.getByRole("heading", { name: "Level ini belum terbuka" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Isi amalan" })).toHaveCount(0);
  await expect(page.locator(".arabic")).toHaveCount(0);
  const bad = await page.goto("/worship/level/4");
  expect(bad?.status()).toBe(404);
});

test("Level 2 aktif: level 1 dan 2 terbuka, level 3 tetap terkunci, progres tidak berubah", async ({ page }) => {
  await page.goto("/dashboard");
  await loadScenario(page, "Level 2 aktif");
  await page.goto("/worship");
  const section = page.getByRole("region", { name: "Riwayat level" });
  await expect(section.getByRole("link")).toHaveCount(2);
  await expect(section.getByText("Sedang berjalan")).toBeVisible();
  await section.getByRole("link", { name: /Level 1/ }).click();
  await expect(page.getByTestId("level-recap")).toBeVisible();
  await page.goto("/worship/level/3");
  await expect(page.getByRole("heading", { name: "Level ini belum terbuka" })).toBeVisible();
  await page.goto("/levels");
  await expect(page.getByTestId("level-2")).toContainText("Aktif");
  await expect(page.getByTestId("level-1")).toContainText("Terbuka");
});

for (const theme of ["light", "dark"] as const) {
  test(`riwayat level: axe dan tanpa luapan horizontal (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
    for (const path of ["/worship", "/worship/level/1", "/worship/level/2"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      expect(
        violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${path}: ${v.id}`),
      ).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
}
