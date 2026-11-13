import { expect, type Page } from "@playwright/test";

export const AUTH_FILE = "tests/e2e/.auth/demo.json";
export const DEMO_EMAIL = "demo@ngajigaes.test";
export const NO_ACCESS_EMAIL = "noaccess@ngajigaes.test";
export const PENDING_EMAIL = "pending@ngajigaes.test";

/** DEMO ONLY: the password of every demo account in mock mode (src/data/mock/fixtures/auth.ts). */
export const DEMO_PASSWORD = "demo-password-aman";
/** DEMO order with no account yet: email and phone are enough to try activation. */
export const NEW_BUYER_EMAIL = "baru@ngajigaes.test";
export const NEW_BUYER_PHONE = "0812-0000-0002";
export const DEMO_PHONE = "0812-0000-0001";
/** A password that passes the policy, for tests that create or change one. */
export const NEW_PASSWORD = "kata-sandi-baru-yang-panjang";

/** Types email and password on /login and presses Masuk. Ends wherever the gates send the user. */
export async function fillLogin(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
}

/** Full sign-in through the screens. Ends wherever the gates send the user. */
export async function signIn(page: Page, email = DEMO_EMAIL, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await fillLogin(page, email, password);
}

/** Opens the demo tools on the sign-in screens and makes a reset link like CS would. Returns its path. */
export async function makeResetLink(page: Page, email: string): Promise<string> {
  await page.getByRole("button", { name: "Buka alat demo masuk" }).click();
  const dialog = page.getByRole("dialog", { name: "Alat demo masuk" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Buat tautan reset demo" }).click();
  const link = dialog.getByTestId("dev-reset-link");
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return href;
}

/** Minimum onboarding: welcome, region, confirm. */
export async function finishOnboarding(page: Page) {
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Mulai", exact: true }).click();
  await page.getByRole("radio", { name: /Jakarta/ }).check();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByRole("button", { name: "Mulai perjalanan" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function userDatabases(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    ((await indexedDB.databases()) ?? []).map((d) => d.name ?? "").filter((n) => n.startsWith("tahajud-u_")),
  );
}
