import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Installs the worker and reloads once so the page is under its control. */
async function controlled(page: Page, path = "/dashboard") {
  await page.goto(path);
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) throw new Error("worker not active");
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test("the service worker registers in the production build and takes control", async ({ page }) => {
  await controlled(page);
  const info = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { script: reg?.active?.scriptURL ?? "", scope: reg?.scope ?? "" };
  });
  expect(info.script).toMatch(/\/sw\.js$/);
  expect(new URL(info.scope).pathname).toBe("/");
});

test("the worker file is never cached by the browser for long", async ({ request }) => {
  const res = await request.get("/sw.js");
  expect(res.ok()).toBe(true);
  expect(res.headers()["cache-control"] ?? "").not.toMatch(/max-age=(?!0)\d{4,}|immutable/);
});

test("no /api/ response is stored in Cache Storage", async ({ page }) => {
  await controlled(page);
  await page.evaluate(async () => {
    for (const p of ["/api/v1/me/access", "/api/v1/me/dashboard"]) await fetch(p).catch(() => null);
  });
  const stored = await page.evaluate(async () => {
    const urls: string[] = [];
    const names = await caches.keys();
    for (const n of names) for (const r of await (await caches.open(n)).keys()) urls.push(r.url);
    return { names, urls };
  });
  expect(stored.names.length).toBeGreaterThan(0);
  expect(stored.names.every((n) => n.startsWith("tahajud-"))).toBe(true);
  expect(stored.urls.filter((u) => new URL(u).pathname.startsWith("/api/"))).toEqual([]);
  expect(stored.urls.some((u) => u.endsWith("/offline.html"))).toBe(true);
});

test("offline: a visited page opens from the saved copy, a new page shows the offline fallback", async ({
  page,
  context,
}) => {
  await controlled(page);
  await page.goto("/worship"); // visited while the worker is in control, so it is saved
  await expect(page.getByRole("heading", { level: 1, name: "Amalan malam ini" })).toBeVisible();

  await context.setOffline(true);
  await page.goto("/worship");
  await expect(page.getByRole("heading", { level: 1, name: "Amalan malam ini" })).toBeVisible();

  await page.goto("/halaman-yang-belum-pernah-dibuka");
  await expect(page.getByRole("heading", { level: 1, name: "Kamu sedang offline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Coba lagi" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Buka beranda" })).toHaveAttribute("href", "/dashboard");
  await context.setOffline(false);
});

test("the offline page is accessible and fits a 320px screen", async ({ page, context }) => {
  await controlled(page);
  await context.setOffline(true);
  await page.goto("/pernah-ada-yang-lain");
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => v.id)).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await context.setOffline(false);
});
