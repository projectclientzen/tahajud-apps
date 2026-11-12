import { expect, type Page } from "@playwright/test";

export const AUTH_FILE = "tests/e2e/.auth/demo.json";
export const DEMO_EMAIL = "demo@ngajigaes.test";
export const NO_ACCESS_EMAIL = "noaccess@ngajigaes.test";
export const PENDING_EMAIL = "pending@ngajigaes.test";

/** Reads the OTP that a real server would email, through the demo tools on the sign-in screens. */
export async function readOtp(page: Page, email: string): Promise<string> {
  await page.getByRole("button", { name: "Buka alat demo masuk" }).click();
  const dialog = page.getByRole("dialog", { name: "Alat demo masuk" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Tampilkan kode OTP" }).click();
  const otp = page.getByTestId("dev-otp");
  await expect(otp).toHaveText(/^\d{6}$/);
  const code = (await otp.textContent())!;
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return code;
}

export async function requestCode(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Kirim kode" }).click();
  await expect(page).toHaveURL(/\/auth\/verify$/);
}

/** Full sign-in through the screens: email, code typed in the app. Ends wherever the gates send the user. */
export async function signIn(page: Page, email = DEMO_EMAIL) {
  await requestCode(page, email);
  const code = await readOtp(page, email);
  await page.getByLabel("Kode 6 digit").fill(code);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
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
