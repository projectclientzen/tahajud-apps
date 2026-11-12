import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`PWA components: axe has no serious or critical violations (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
    await page.goto("/dev/pwa");
    await expect(page.getByRole("heading", { level: 1, name: "Komponen PWA" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id),
    ).toEqual([]);
  });
}

test("PWA components fit a 320px screen without sideways scroll", async ({ page }) => {
  await page.goto("/dev/pwa");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("install guide: platform choice is a keyboard operable radio group and swaps the steps", async ({ page }) => {
  await page.goto("/dev/pwa");
  const group = page.getByRole("group", { name: "Pilih perangkat" });
  await expect(group.getByRole("radio")).toHaveCount(3);

  await group.getByRole("radio", { name: "iPhone atau iPad" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("Tambah ke Layar Utama", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("iOS 16.4")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(4);

  await page.keyboard.press("ArrowRight"); // next radio in the group: Komputer
  await expect(group.getByRole("radio", { name: "Komputer" })).toBeChecked();
  await expect(page.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByText("Chrome atau Edge").first()).toBeVisible();
});

test("install guide: touch targets are at least 44px and the checked option is not color only", async ({ page }) => {
  await page.goto("/dev/pwa");
  const labels = page.locator("fieldset label");
  for (const l of await labels.all()) expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // exactly one option is checked, and only that one carries a check icon next to its label
  expect(await page.locator("fieldset input:checked").count()).toBe(1);
  expect(await page.locator("fieldset label svg").count()).toBe(1);
  expect(await page.locator("fieldset label:has(input:checked) svg").count()).toBe(1);
});

test("update prompt: button is a real button with a pointer cursor", async ({ page }) => {
  await page.goto("/dev/pwa");
  const btn = page.getByRole("button", { name: "Perbarui sekarang" });
  await expect(btn).toBeVisible();
  expect(await btn.evaluate((el) => getComputedStyle(el).cursor)).toBe("pointer");
  expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("install guide shows the installed state in standalone mode", async ({ page }) => {
  await page.emulateMedia({ media: "screen" });
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q: string) =>
      q.includes("display-mode: standalone")
        ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList)
        : real(q);
  });
  await page.goto("/dev/pwa");
  await expect(page.getByText("Aplikasi sudah terpasang di perangkat ini.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Pilih perangkat" })).toHaveCount(0);
});

test("@screens pwa components", async ({ page }, info) => {
  test.skip(!process.env.PW_SCREENS, "screenshots only on request");
  await page.goto("/dev/pwa");
  await page.screenshot({ path: `docs/screenshots/s4a/pwa-${info.project.name}.png`, fullPage: true });
});
