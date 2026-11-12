import { expect, type Page } from "@playwright/test";

/** Opens the demo tools sheet, runs `fn`, then closes it. Mock mode only. */
export async function withDevPanel<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  await page.getByRole("button", { name: "Buka alat demo" }).click();
  const dialog = page.getByRole("dialog", { name: "Alat demo" });
  await expect(dialog).toBeVisible();
  const result = await fn();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return result;
}

export async function loadScenario(page: Page, label: string) {
  await withDevPanel(page, async () => {
    await page.getByLabel("Skenario").selectOption({ label });
    await page.getByRole("button", { name: "Muat skenario" }).click();
    await expect(page.getByRole("button", { name: "Muat skenario" })).toBeEnabled();
  });
}

/** Time travel to a local WIB time such as "2026-11-20T03:30". */
export async function setDemoTime(page: Page, stamp: string) {
  await withDevPanel(page, async () => {
    await page.getByLabel("Atur jam (WIB)").fill(stamp);
    await page.getByRole("button", { name: "Terapkan jam" }).click();
    await expect(page.getByRole("button", { name: "Terapkan jam" })).toBeEnabled();
  });
}

export async function readRequestCounter(page: Page): Promise<number> {
  return withDevPanel(page, async () => {
    const text = (await page.getByTestId("dev-requests").textContent()) ?? "";
    return Number(text.replace(/\D/g, ""));
  });
}

/** Starts tonight's session from the Amalan screen and returns once the checklist is visible. */
export async function startSession(page: Page) {
  await page.goto("/worship/session");
  await page.getByRole("button", { name: "Mulai ibadah malam ini" }).click();
  await expect(page.getByRole("heading", { name: "Malam", exact: true })).toBeVisible();
}

export async function openCounter(page: Page, title: string) {
  await page
    .getByRole("link", { name: new RegExp(title) })
    .first()
    .click();
  await expect(page.getByTestId("count")).toBeVisible();
}
