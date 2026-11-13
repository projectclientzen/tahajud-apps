import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { loadScenario, startSession } from "./s3-helpers";

test("Level 1: tombol Lihat niat di tiga langkah salat, sheet berisi teks Arab dan Latin dari owner", async ({ page }) => {
  await startSession(page);
  const buttons = page.getByRole("button", { name: /^Lihat niat/ });
  await expect(buttons).toHaveCount(3);
  const tahajud = page.getByRole("button", { name: "Lihat niat Salat Tahajud" });
  const box = page.getByRole("checkbox").first();
  const before = await box.isChecked();
  await tahajud.click();
  const dialog = page.getByRole("dialog", { name: "Niat Salat Tahajud" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("niat-text")).toBeVisible();
  await expect(dialog.locator(".arabic")).toHaveCount(1);
  await expect(dialog.getByText("Bacaan niat belum tersedia")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // Opening the sheet must not tick anything.
  expect(await box.isChecked()).toBe(before);
});

test("Level 2: lima langkah salat punya tombol niat, Qabliyah Subuh tidak", async ({ page }) => {
  await page.goto("/dashboard");
  await loadScenario(page, "Level 2 aktif");
  await startSession(page);
  await expect(page.getByRole("button", { name: /^Lihat niat/ })).toHaveCount(5);
  await expect(page.getByRole("button", { name: /Lihat niat .*Qabliyah/ })).toHaveCount(0);
  for (const name of ["Taubat", "Tahajud", "Hajat", "Witir (1 rakaat)", "Witir (2 rakaat)"]) {
    await expect(page.getByRole("button", { name: new RegExp(`Lihat niat .*${name.replace(/[()]/g, "\\$&")}`) })).toBeVisible();
  }
  await page.getByRole("button", { name: /Lihat niat .*Witir \(2 rakaat\)/ }).click();
  await expect(page.getByRole("dialog").getByText(/menghadap kiblat/)).toBeVisible();
});

test("dzikir dan salat Subuh tidak punya tombol niat", async ({ page }) => {
  await startSession(page);
  await expect(page.getByRole("button", { name: /Lihat niat (Istighfar|Salat Subuh$)/ })).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`sheet niat: axe dan target sentuh (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
    await startSession(page);
    const b = page.getByRole("button", { name: "Lihat niat Salat Taubat" });
    const box = (await b.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    await b.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  });
}
