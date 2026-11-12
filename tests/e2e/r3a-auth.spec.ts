import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  DEMO_EMAIL,
  NO_ACCESS_EMAIL,
  PENDING_EMAIL,
  finishOnboarding,
  readOtp,
  requestCode,
  signIn,
} from "./r3a-helpers";

// These specs start signed out. Everything else starts from the saved demo session.
test.use({ storageState: { cookies: [], origins: [] } });

async function serious(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${label}: ${v.id} ${v.nodes.length} (${v.nodes[0]?.target.join(" ")})`);
}

test("entry page offers sign in to a signed-out visitor", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Masuk" })).toBeVisible();
  await page.getByRole("link", { name: "Masuk" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("signed-out visitors cannot open app pages", async ({ page }) => {
  for (const path of ["/dashboard", "/worship/session", "/levels", "/onboarding", "/access-status"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test("AUTH-06: the screen after requesting a code is the same for any email", async ({ page }) => {
  const seen: string[] = [];
  for (const email of [DEMO_EMAIL, "tidak.terdaftar@contoh.test"]) {
    await requestCode(page, email);
    const text = (await page.locator("main").innerText()).split(email).join("EMAIL");
    seen.push(text);
  }
  expect(seen[0]).toBe(seen[1]);
  expect(seen[0]).toContain("Jika email ini punya akses");
});

test("AUTH-06: a wrong code gives one generic message", async ({ page }) => {
  await requestCode(page, NO_ACCESS_EMAIL);
  await page.getByLabel("Kode 6 digit").fill("000000");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page.locator("#otp-error")).toHaveText("Kode tidak valid atau sudah kedaluwarsa.");
  await expect(page).toHaveURL(/\/auth\/verify$/);
});

test("AUTH-07: sign in finishes inside the app, with the code typed in, no other page or tab", async ({
  page,
  context,
}) => {
  const origins = new Set<string>();
  page.on("framenavigated", (f) => f.parentFrame() === null && origins.add(new URL(f.url()).origin));
  await signIn(page);
  await expect(page).toHaveURL(/\/onboarding$/);
  expect(context.pages()).toHaveLength(1);
  expect([...origins]).toHaveLength(1);
  await expect(page.getByLabel("Kode 6 digit")).toHaveCount(0);
});

test("resend is locked for 60 seconds and the help list is there", async ({ page }) => {
  await requestCode(page, DEMO_EMAIL);
  await page.getByText("Tidak menerima kode?").click();
  await expect(page.getByText("Cek folder spam atau promosi.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Kirim ulang kode \(\d+ detik\)/ })).toBeDisabled();
});

test("onboarding takes at most 3 screens from first sign-in to the dashboard", async ({ page }) => {
  await signIn(page);
  const steps: string[] = [];
  const step = page.getByTestId("onboarding-step");
  await expect(step).toHaveText("Langkah 1 dari 3");
  steps.push((await step.textContent())!);
  await page.getByRole("button", { name: "Mulai", exact: true }).click();
  await expect(step).toHaveText("Langkah 2 dari 3");
  steps.push((await step.textContent())!);
  await page.getByRole("radio", { name: /Jakarta/ }).check();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(step).toHaveText("Langkah 3 dari 3");
  steps.push((await step.textContent())!);
  await expect(page.getByTestId("confirm-fajr")).toContainText("WIB");
  await page.getByRole("button", { name: "Mulai perjalanan" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(steps).toHaveLength(3);
  await expect(page.getByText("Subuh berikutnya")).toBeVisible();
});

test("onboarding with a manual schedule shows the Fajr time that was typed", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Mulai", exact: true }).click();
  await page.getByRole("radio", { name: "Atur jadwal manual" }).check();
  await page.getByLabel("Zona waktu").selectOption("Asia/Riyadh");
  await page.getByLabel("Jam Subuh").fill("04:45");
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByTestId("confirm-fajr")).toContainText("04.45");
  await page.getByRole("button", { name: "Mulai perjalanan" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("an email without access sees what to do next, not a dashboard", async ({ page }) => {
  await signIn(page, NO_ACCESS_EMAIL);
  await expect(page).toHaveURL(/\/access-status$/);
  await expect(page.getByText("Belum ada akses aktif untuk email ini")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/access-status$/);
});

test("a purchase that is not verified yet shows a calm waiting state", async ({ page }) => {
  await signIn(page, PENDING_EMAIL);
  await expect(page).toHaveURL(/\/access-status$/);
  await expect(page.getByText("Pembelianmu sedang diverifikasi")).toBeVisible();
});

test("access turned on later: the waiting screen moves on to onboarding", async ({ page }) => {
  await signIn(page, PENDING_EMAIL);
  await expect(page.getByText("Pembelianmu sedang diverifikasi")).toBeVisible();
  await page.getByRole("button", { name: "Buka alat demo masuk" }).click();
  await page.getByRole("button", { name: "Aktif", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("axe: sign in, verify, onboarding and access screens (no serious or critical)", async ({ page }) => {
  const found: string[] = [];
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  found.push(...(await serious(page, "/login")));
  await requestCode(page, DEMO_EMAIL);
  found.push(...(await serious(page, "/auth/verify")));
  const code = await readOtp(page, DEMO_EMAIL);
  await page.getByLabel("Kode 6 digit").fill(code);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  found.push(...(await serious(page, "/onboarding welcome")));
  await page.getByRole("button", { name: "Mulai", exact: true }).click();
  found.push(...(await serious(page, "/onboarding region")));
  await page.getByRole("radio", { name: "Atur jadwal manual" }).check();
  found.push(...(await serious(page, "/onboarding manual")));
  await page.getByRole("radio", { name: "Pilih wilayah" }).check();
  await page.getByRole("radio", { name: /Jakarta/ }).check();
  await page.getByRole("button", { name: "Lanjut" }).click();
  found.push(...(await serious(page, "/onboarding confirm")));
  expect(found).toEqual([]);
});

test("axe: access status in light and dark", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tt-theme", "dark"));
  await signIn(page, NO_ACCESS_EMAIL);
  await expect(page.getByText("Belum ada akses aktif untuk email ini")).toBeVisible();
  expect(await serious(page, "/access-status dark")).toEqual([]);
});

test("phone width: sign in and onboarding do not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.goto("/login");
  expect(await overflow()).toBeLessThanOrEqual(0);
  await signIn(page);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await finishOnboardingAt320(page);
  expect(await overflow()).toBeLessThanOrEqual(0);
});

async function finishOnboardingAt320(page: Page) {
  await page.getByRole("button", { name: "Mulai", exact: true }).click();
  await page.getByRole("radio", { name: /Jakarta/ }).check();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByRole("button", { name: "Mulai perjalanan" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("finishOnboarding helper path lands on the dashboard", async ({ page }) => {
  await signIn(page);
  await finishOnboarding(page);
  await expect(page.getByText("Subuh berikutnya")).toBeVisible();
});
