import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_PHONE,
  NEW_BUYER_EMAIL,
  NEW_BUYER_PHONE,
  NEW_PASSWORD,
  NO_ACCESS_EMAIL,
  PENDING_EMAIL,
  fillLogin,
  finishOnboarding,
  makeResetLink,
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

test("AUTH-09: a wrong password and an unknown email give the same message", async ({ page }) => {
  const seen: string[] = [];
  for (const email of [DEMO_EMAIL, "tidak.terdaftar@contoh.test"]) {
    await page.goto("/login");
    await fillLogin(page, email, "salah-salah-1");
    await expect(page.locator("#login-error")).toBeVisible();
    seen.push((await page.locator("#login-error").innerText()).trim());
    await expect(page).toHaveURL(/\/login$/);
  }
  expect(seen[0]).toBe("Email atau password salah.");
  expect(seen[1]).toBe(seen[0]);
});

test("login: Enter in the password field signs in, and the show button reveals the password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO_EMAIL);
  const field = page.getByLabel("Password", { exact: true });
  await field.fill(DEMO_PASSWORD);
  await expect(field).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Tampilkan password" }).click();
  await expect(field).toHaveAttribute("type", "text");
  await field.press("Enter");
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("AUTH-07: sign in finishes inside the app with a typed password, no other page or tab", async ({
  page,
  context,
}) => {
  const origins = new Set<string>();
  page.on("framenavigated", (f) => f.parentFrame() === null && origins.add(new URL(f.url()).origin));
  await signIn(page);
  await expect(page).toHaveURL(/\/onboarding$/);
  expect(context.pages()).toHaveLength(1);
  expect([...origins]).toHaveLength(1);
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
});

test("login offers forgot password and activation, and the old code screen is gone", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Lupa password?" })).toHaveAttribute("href", "/forgot-password");
  await expect(page.getByRole("link", { name: "Baru beli? Aktivasi akun" })).toHaveAttribute("href", "/activate");
  await expect(page.getByText(/kode/i)).toHaveCount(0);
  await page.goto("/auth/verify");
  await expect(page).toHaveURL(/\/login$/);
});

test.describe("ACT: activation with email and phone of a paid order (DEMO order)", () => {
  async function fillIdentity(page: Page, email: string, phone: string) {
    await page.goto("/activate");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Nomor HP").fill(phone);
    await page.getByRole("button", { name: "Lanjut" }).click();
  }

  test("ACT-01: email + phone, then a password, creates the account and signs in", async ({ page }) => {
    await fillIdentity(page, NEW_BUYER_EMAIL, NEW_BUYER_PHONE);
    await expect(page.getByRole("heading", { name: "Buat password", level: 1 })).toBeFocused();
    await page.getByLabel("Password baru", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Ulangi password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Aktifkan akun" }).click();
    await expect(page.getByTestId("activated-email")).toHaveText(NEW_BUYER_EMAIL);
    await expect(page.getByRole("heading", { name: "Akun aktif", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Lanjut ke aplikasi" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test("ACT-01: the phone can be written as +62 and the new password works on the next login", async ({ page }) => {
    await fillIdentity(page, NEW_BUYER_EMAIL, "+62 812-0000-0002");
    await page.getByLabel("Password baru", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Ulangi password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Aktifkan akun" }).click();
    await page.getByRole("button", { name: "Lanjut ke aplikasi" }).click();
    await finishOnboarding(page);
    // sign out, then the password that was just chosen opens the account again
    await page.getByRole("button", { name: "Keluar" }).filter({ visible: true }).first().click();
    await page
      .getByRole("dialog", { name: "Keluar dari perangkat ini?" })
      .getByRole("button", { name: "Keluar", exact: true })
      .click();
    await expect(page).toHaveURL(/\/login$/);
    await fillLogin(page, NEW_BUYER_EMAIL, NEW_PASSWORD);
    // Local demo data is cleared at sign-out, so the demo account walks through onboarding again.
    await expect(page).toHaveURL(/\/(onboarding|dashboard)$/);
  });

  test("ACT-02: a wrong phone, an unknown email and an account that already exists give the same message", async ({
    page,
  }) => {
    const seen: string[] = [];
    for (const [email, phone] of [
      [NEW_BUYER_EMAIL, "0812-9999-9999"],
      ["tidak.ada@contoh.test", NEW_BUYER_PHONE],
      [DEMO_EMAIL, DEMO_PHONE],
    ] as const) {
      await fillIdentity(page, email, phone);
      await page.getByLabel("Password baru", { exact: true }).fill(NEW_PASSWORD);
      await page.getByLabel("Ulangi password", { exact: true }).fill(NEW_PASSWORD);
      await page.getByRole("button", { name: "Aktifkan akun" }).click();
      const alert = page.getByRole("alert").filter({ hasText: "Data tidak cocok" });
      await expect(alert).toBeVisible();
      seen.push((await alert.innerText()).trim());
      await expect(page.getByRole("link", { name: "Lupa password?" })).toBeVisible();
    }
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toContain("Data tidak cocok atau akun sudah aktif");
  });

  test("a weak password is explained before anything is sent", async ({ page }) => {
    await fillIdentity(page, NEW_BUYER_EMAIL, NEW_BUYER_PHONE);
    await page.getByLabel("Password baru", { exact: true }).fill("pendek");
    await expect(page.getByText("Password minimal 10 karakter.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Aktifkan akun" })).toBeDisabled();
    await page.getByLabel("Password baru", { exact: true }).fill("password123");
    await expect(page.getByText(/terlalu umum/)).toBeVisible();
    await page.getByLabel("Password baru", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Ulangi password", { exact: true }).fill(`${NEW_PASSWORD}x`);
    await expect(page.getByText("Password belum sama.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Aktifkan akun" })).toBeDisabled();
  });

  test("a phone that is not a phone is caught on the first step", async ({ page }) => {
    await fillIdentity(page, NEW_BUYER_EMAIL, "bukan nomor");
    await expect(page.locator("main").getByRole("alert")).toContainText("Nomor HP belum benar");
    await expect(page.getByRole("heading", { name: "Aktivasi akun", level: 1 })).toBeVisible();
  });

  test("ACT-04: after 5 wrong tries the screen says to wait, without saying why", async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await fillIdentity(page, NEW_BUYER_EMAIL, `0812-9999-000${i}`);
      await page.getByLabel("Password baru", { exact: true }).fill(NEW_PASSWORD);
      await page.getByLabel("Ulangi password", { exact: true }).fill(NEW_PASSWORD);
      await page.getByRole("button", { name: "Aktifkan akun" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Data tidak cocok" })).toBeVisible();
    }
    await fillIdentity(page, NEW_BUYER_EMAIL, NEW_BUYER_PHONE);
    await page.getByLabel("Password baru", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Ulangi password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Aktifkan akun" }).click();
    const alert = page.getByRole("alert").filter({ hasText: "Terlalu sering mencoba" });
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/email|nomor|HP/i);
  });
});

test.describe("forgot password without email (email + phone of the order)", () => {
  test("ACT-06: sets a new password, all devices go out, and the old password stops working", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(DEMO_EMAIL);
    await page.getByLabel("Nomor HP").fill(DEMO_PHONE);
    await page.getByLabel("Password baru", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Ulangi password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Ganti password" }).click();
    await expect(page.getByRole("heading", { name: "Password diganti", level: 1 })).toBeFocused();
    await expect(page.getByRole("status")).toContainText("Semua perangkat sudah keluar");
    // no session was opened
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await fillLogin(page, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page.locator("#login-error")).toHaveText("Email atau password salah.");
    await fillLogin(page, DEMO_EMAIL, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test("a wrong phone gives the generic message and points to CS", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(DEMO_EMAIL);
    await page.getByLabel("Nomor HP").fill("0812-9999-9999");
    await page.getByLabel("Password baru", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Ulangi password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Ganti password" }).click();
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toContainText("Data tidak cocok atau akun sudah aktif");
    await expect(alert).toContainText("CS bisa mengirim tautan reset");
  });
});

test.describe("reset link from CS (admin token)", () => {
  test("ADMIN-RESET-01: the link works once, takes the token out of the address bar, and signs in", async ({ page }) => {
    await page.goto("/login");
    const link = await makeResetLink(page, DEMO_EMAIL);
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Buat password baru", level: 1 })).toBeVisible();
    await expect(page).toHaveURL(/\/reset$/); // the fragment is gone from the address bar and the history
    await page.getByLabel("Password baru", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Ulangi password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Simpan password" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);

    // the same link again
    await page.goto(link);
    await page.getByLabel("Password baru", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Ulangi password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Simpan password" }).click();
    await expect(page.getByRole("heading", { name: "Tautan tidak berlaku", level: 1 })).toBeVisible();
  });

  test("a page opened without a token, or with a made up one, says the link is not valid", async ({ page }) => {
    await page.goto("/reset");
    await expect(page.getByRole("heading", { name: "Tautan tidak berlaku", level: 1 })).toBeVisible();
    await page.goto("/login"); // a fragment-only change would not reload the page, a real link opens a fresh one
    await page.goto("/reset#t=abcdefghijklmnopqrstuvwxyz0123456789");
    await page.getByLabel("Password baru", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Ulangi password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Simpan password" }).click();
    await expect(page.getByRole("heading", { name: "Tautan tidak berlaku", level: 1 })).toBeVisible();
  });

  test("the reset page sends no Referer", async ({ request }) => {
    const res = await request.get("/reset");
    expect(res.headers()["referrer-policy"]).toBe("no-referrer");
  });
});

test("the payment success page grants nothing and sends the buyer to activation", async ({ page }) => {
  await page.goto("/payment/success?order=123&token=abc");
  await expect(page.getByRole("heading", { name: "Pembayaran diterima", level: 1 })).toBeVisible();
  await expect(page.getByText("Pakai email dan nomor HP yang sama dengan saat order.")).toBeVisible();
  await page.getByRole("link", { name: "Aktivasi akun" }).click();
  await expect(page).toHaveURL(/\/activate$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
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
  // The panel writes the new entitlement to IndexedDB, then shows this line. A reload before it can cancel the write.
  await expect(page.getByRole("status").filter({ hasText: `Akses ${PENDING_EMAIL}: active` })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("axe: login, activation, forgot password, reset and payment screens (no serious or critical)", async ({
  page,
}) => {
  const found: string[] = [];
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  found.push(...(await serious(page, "/login")));
  await page.goto("/activate");
  await expect(page.getByLabel("Nomor HP")).toBeVisible();
  found.push(...(await serious(page, "/activate identity")));
  await page.getByLabel("Email").fill(NEW_BUYER_EMAIL);
  await page.getByLabel("Nomor HP").fill(NEW_BUYER_PHONE);
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByLabel("Password baru", { exact: true })).toBeVisible();
  found.push(...(await serious(page, "/activate password")));
  await page.getByLabel("Password baru", { exact: true }).fill("pendek");
  found.push(...(await serious(page, "/activate password error")));
  await page.goto("/forgot-password");
  await expect(page.getByLabel("Nomor HP")).toBeVisible();
  found.push(...(await serious(page, "/forgot-password")));
  await page.goto("/reset");
  await expect(page.getByRole("heading", { name: "Tautan tidak berlaku" })).toBeVisible();
  found.push(...(await serious(page, "/reset invalid")));
  await page.goto("/payment/success");
  await expect(page.getByRole("heading", { name: "Pembayaran diterima" })).toBeVisible();
  found.push(...(await serious(page, "/payment/success")));
  await signIn(page);
  await expect(page).toHaveURL(/\/onboarding$/);
  found.push(...(await serious(page, "/onboarding welcome")));
  await page.getByRole("button", { name: "Mulai", exact: true }).click();
  found.push(...(await serious(page, "/onboarding region")));
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

test("phone width: auth screens and onboarding do not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  for (const path of ["/login", "/activate", "/forgot-password", "/reset", "/payment/success"]) {
    await page.goto(path);
    expect(await overflow(), path).toBeLessThanOrEqual(0);
  }
  await page.goto("/login");
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
