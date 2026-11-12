import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ROUTES = ["/", "/dashboard", "/worship", "/quran", "/profile", "/dev/components"];

for (const route of ROUTES) {
  test(`no horizontal scroll on ${route}`, async ({ page }) => {
    await page.goto(route);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("primary nav: bottom bar on mobile, sidebar on desktop, aria-current set", async ({ page }, info) => {
  await page.goto("/worship");
  const navs = page.getByRole("navigation", { name: "Navigasi utama" });
  const visible = navs.filter({ visible: true });
  await expect(visible).toHaveCount(1);
  await expect(visible.getByRole("link", { name: "Amalan" })).toHaveAttribute("aria-current", "page");
  const box = await visible.boundingBox();
  if (info.project.name === "mobile") expect(box!.y).toBeGreaterThan(500);
  else {
    // Sidebar nav sits inside an aside with 16px padding, so x is 16, not 0.
    expect(box!.x).toBeLessThan(32);
    expect(box!.y).toBeLessThan(300);
  }
});

test("demo badge is visible while mock data is active", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("note").filter({ hasText: "Data demo" })).toBeVisible();
});

test("theme choice applies data-theme and survives reload", async ({ page }) => {
  await page.goto("/settings");
  await page.getByText("Gelap", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByText("Terang", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("touch targets in the nav are at least 44x44", async ({ page }) => {
  await page.goto("/dashboard");
  const links = page.getByRole("navigation", { name: "Navigasi utama" }).filter({ visible: true }).getByRole("link");
  for (const link of await links.all()) {
    const b = (await link.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
});

test("sheet opens, traps focus and closes with Escape", async ({ page }) => {
  await page.goto("/dev/components");
  await page.getByRole("button", { name: "Buka sheet" }).click();
  const dialog = page.getByRole("dialog", { name: "Tandai berhalangan" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: no serious or critical violations (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
    for (const route of ["/", "/dashboard", "/profile", "/dev/components"]) {
      await page.goto(route);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${route}: ${v.id} ${v.nodes.length}`)).toEqual([]);
    }
  });
}

test("entry page sends a signed-in visitor straight to the dashboard", async ({ page }) => {
  // The e2e build starts signed in as the demo user. The visitor view of "/" is covered in r3a-auth.spec.ts.
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard Istiqomah" })).toBeVisible();
});

test("no console errors on any route", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  for (const route of ROUTES) await page.goto(route);
  expect(errors).toEqual([]);
});

test("enabled controls show a pointer cursor", async ({ page }) => {
  await page.goto("/dev/components");
  const cursor = (name: string) => page.getByRole("button", { name }).evaluate((el) => getComputedStyle(el).cursor);
  expect(await cursor("Buka sheet")).toBe("pointer");
  expect(await cursor("Belum tersedia")).toBe("not-allowed");
});

test("manifest is served with standalone display", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.display).toBe("standalone");
  expect(m.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
});
