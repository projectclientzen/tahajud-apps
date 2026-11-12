import { expect, type Page } from "@playwright/test";
import { withDevPanel } from "./s3-helpers";

export const DEMO_EMAIL = "demo@ngajigaes.test";
export const FRESH_EMAIL = "baru@ngajigaes.test";

/** Picks a sign-in state in the demo tools (label of the option) and applies it. */
export async function setAccountState(page: Page, label: string) {
  await withDevPanel(page, async () => {
    await page.getByLabel("Status akun demo").selectOption({ label });
    await page.getByRole("button", { name: "Terapkan status akun" }).click();
  });
}

/**
 * The e2e build starts signed in. This signs the browser out through the demo tools and waits for the login screen.
 */
export async function asVisitor(page: Page, state = "Belum masuk") {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard Istiqomah" })).toBeVisible();
  await setAccountState(page, state);
}

/** Reads the code that a real server would have emailed, from the demo tools. */
export async function readOtp(page: Page): Promise<string> {
  return withDevPanel(page, async () => {
    const text = (await page.getByTestId("dev-otp").textContent()) ?? "";
    const code = /(\d{6})/.exec(text)?.[1];
    expect(code, `no code in "${text}"`).toBeTruthy();
    return code!;
  });
}

/** Login screen: type the email and ask for the code. Lands on the code screen. */
export async function requestCode(page: Page, email: string) {
  await expect(page.getByRole("heading", { name: "Masuk", level: 1 })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Kirim kode" }).click();
  await expect(page).toHaveURL(/\/auth\/verify$/);
  await expect(page.getByRole("heading", { name: "Masukkan kode", level: 1 })).toBeVisible();
}

/** Whole sign-in with the code read from the demo tools. */
export async function signIn(page: Page, email: string) {
  await requestCode(page, email);
  const code = await readOtp(page);
  await page.getByLabel("Kode 6 digit").pressSequentially(code);
}
