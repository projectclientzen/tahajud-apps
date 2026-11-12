import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loadScenario, openCounter, startSession } from "./s3-helpers";

async function serious(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  return bad.map((v) => `${label}: ${v.id} ${v.nodes.length} (${v.nodes[0]?.target.join(" ")})`);
}

async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} overflows horizontally`).toBeLessThanOrEqual(0);
}

for (const theme of ["light", "dark"] as const) {
  test(`axe: S3 routes have no serious or critical violations (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
    const found: string[] = [];

    await page.goto("/dashboard");
    await expect(page.getByText("Belum ada catatan")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    found.push(...(await serious(page, "/dashboard (new account)")));
    await noOverflow(page, "/dashboard (new account)");

    await loadScenario(page, "Level 2 aktif");
    await expect(page.getByText("Riwayat istiqomah")).toBeVisible();
    found.push(...(await serious(page, "/dashboard (level 2)")));
    await noOverflow(page, "/dashboard (level 2)");

    await page.goto("/levels");
    await expect(page.getByTestId("level-2")).toContainText("Aktif");
    found.push(...(await serious(page, "/levels")));
    await noOverflow(page, "/levels");

    await page.goto("/worship");
    await expect(page.getByText("rakaat salat malam")).toBeVisible();
    found.push(...(await serious(page, "/worship")));
    await noOverflow(page, "/worship");

    await startSession(page);
    found.push(...(await serious(page, "/worship/session")));
    await noOverflow(page, "/worship/session");

    await openCounter(page, "Istighfar");
    await page.getByRole("button", { name: "Tambah satu hitungan" }).click();
    found.push(...(await serious(page, "/worship/dhikr/[id]")));
    await noOverflow(page, "/worship/dhikr/[id]");

    await page.getByRole("button", { name: "Buka alat demo" }).click();
    await expect(page.getByRole("dialog", { name: "Alat demo" })).toBeVisible();
    found.push(...(await serious(page, "dev panel")));
    await page.keyboard.press("Escape");

    expect(found).toEqual([]);
  });
}

test("tap target is at least 160px and the Arabic text is right to left", async ({ page }) => {
  await startSession(page);
  await openCounter(page, "Istighfar");
  const box = (await page.getByRole("button", { name: "Tambah satu hitungan" }).boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(160);
  expect(box.height).toBeGreaterThanOrEqual(160);
  const dir = await page
    .locator("p.arabic")
    .first()
    .evaluate((el) => getComputedStyle(el).direction);
  expect(dir).toBe("rtl");
});
