import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { asVisitor, DEMO_EMAIL, FRESH_EMAIL, readOtp, requestCode, setAccountState, signIn } from "./r3a-helpers";

test.describe("sign in", () => {
  test("AUTH-07: the code is typed inside the app, nothing leaves the site", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.hostname !== "localhost" && !u.protocol.startsWith("data")) external.push(r.url());
    });
    await asVisitor(page);
    await expect(page).toHaveURL(/\/login$/);
    await requestCode(page, DEMO_EMAIL);

    // Same message for everyone, with the spam hint.
    await expect(page.getByRole("status").filter({ hasText: "Jika email ini punya akses" })).toBeVisible();
    const code = await readOtp(page);
    const input = page.getByLabel("Kode 6 digit");
    await expect(input).toHaveAttribute("inputmode", "numeric");
    await expect(input).toHaveAttribute("autocomplete", "one-time-code");
    await input.pressSequentially(code);

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard Istiqomah" })).toBeVisible();
    expect(external).toEqual([]);
  });

  test("AUTH-07: pasting a code with spaces works, a wrong code shows one generic message", async ({ page }) => {
    await asVisitor(page);
    await requestCode(page, DEMO_EMAIL);
    const code = await readOtp(page);
    const input = page.getByLabel("Kode 6 digit");

    await input.fill("000000");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Kode tidak valid atau sudah kedaluwarsa.");
    await expect(input).toHaveValue("");
    await expect(input).toBeFocused();

    await input.fill(`${code.slice(0, 3)} ${code.slice(3)}`);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("AUTH-06: the code screen looks the same for an email with access and one without", async ({ page }) => {
    await asVisitor(page);
    const seen: string[] = [];
    for (const email of [DEMO_EMAIL, "tidak.terdaftar@example.test"]) {
      await page.goto("/login");
      await requestCode(page, email);
      const text = await page.getByRole("main").innerText();
      seen.push(text.replaceAll(email, "EMAIL"));
      await page.getByRole("button", { name: "Pakai email lain" }).click();
      await expect(page).toHaveURL(/\/login$/);
    }
    expect(seen[0]).toBe(seen[1]);
  });

  test("AUTH-06: after too many requests the user gets a friendly wait time, not an error code", async ({ page }) => {
    await asVisitor(page);
    await page.clock.install();
    await page.goto("/login");
    for (let i = 0; i < 5; i++) {
      await requestCode(page, DEMO_EMAIL);
      await page.clock.fastForward(61_000); // past the 60 second cooldown
      await page.goto("/login");
    }
    await page.getByLabel("Email").fill(DEMO_EMAIL);
    await page.getByRole("button", { name: "Kirim kode" }).click();
    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toContainText("Terlalu sering meminta kode. Coba lagi dalam");
    await expect(alert).not.toContainText("RATE_LIMITED");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a malformed email gets a friendly message and stays on the form", async ({ page }) => {
    await asVisitor(page);
    await page.getByLabel("Email").fill("bukan-email");
    await page.getByRole("button", { name: "Kirim kode" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Format email belum benar");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("OPS-01: resend wakes up after 60 seconds, help shows spam, Scalev, and WhatsApp", async ({ page }) => {
    await asVisitor(page);
    await page.clock.install();
    await page.goto("/login");
    await requestCode(page, DEMO_EMAIL);
    await page.getByText("Tidak menerima kode?").click();
    await expect(page.getByText("Cek folder spam atau promosi")).toBeVisible();
    await expect(page.getByText("email yang kamu pakai saat checkout di Scalev")).toBeVisible();
    const wa = page.getByRole("link", { name: /Hubungi CS di WhatsApp/ });
    await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\/6281234567890\?text=/);
    expect(decodeURIComponent((await wa.getAttribute("href")) ?? "")).not.toContain(DEMO_EMAIL);

    const resend = page.getByRole("button", { name: /Kirim ulang kode/ });
    await expect(resend).toBeDisabled();
    await expect(resend).toContainText("dtk");
    await page.clock.fastForward(61_000);
    await expect(resend).toBeEnabled();
    await resend.click();
    await expect(page.getByText("Kode baru sudah dikirim")).toBeVisible();
    await expect(resend).toBeDisabled();
  });
});

test.describe("device limit", () => {
  test("AUTH-DEVICE: the 4th device is refused, one is removed by the user, then login continues", async ({ page }) => {
    await asVisitor(page, "Belum masuk, akun sudah di 3 perangkat");
    await signIn(page, DEMO_EMAIL);

    await expect(
      page.getByRole("heading", { name: "Akunmu sudah aktif di 3 perangkat (maksimal)", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(3);
    await expect(page.getByText(/Terakhir aktif/).first()).toBeVisible();
    const go = page.getByRole("button", { name: /Keluarkan perangkat ini dan lanjut masuk/ });
    await expect(go).toBeDisabled();
    // Nothing was removed and no session exists yet: a reload returns to the code screen, and the app stays closed.
    await page.reload();
    await expect(page).toHaveURL(/\/auth\/verify$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("AUTH-DEVICE: choosing a device signs it out and logs this one in", async ({ page }) => {
    await asVisitor(page, "Belum masuk, akun sudah di 3 perangkat");
    await signIn(page, DEMO_EMAIL);
    await page.getByRole("radio", { name: /Contoh: Laptop Firefox/ }).check();
    await page.getByRole("button", { name: /Keluarkan perangkat ini dan lanjut masuk/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard Istiqomah" })).toBeVisible();
  });

  test("AUTH-DEVICE: cancel returns to login and the user stays signed out", async ({ page }) => {
    await asVisitor(page, "Belum masuk, akun sudah di 3 perangkat");
    await signIn(page, DEMO_EMAIL);
    await page.getByRole("button", { name: "Batal" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("route guards", () => {
  test("a visitor is sent to /login from every app route", async ({ page }) => {
    await asVisitor(page);
    for (const route of ["/dashboard", "/worship", "/levels", "/worship/session"]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test("a signed-in user is sent away from /login and /", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("the entry page shows Masuk to a visitor", async ({ page }) => {
    await asVisitor(page);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Masuk" })).toBeVisible();
    await page.getByRole("link", { name: "Masuk" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("OPS-03: purchase not verified goes to /access-status and explains the wait", async ({ page }) => {
    await asVisitor(page, "Masuk, pembelian belum terverifikasi");
    await expect(page).toHaveURL(/\/access-status$/);
    await expect(page.getByText("Pembelianmu sedang diverifikasi")).toBeVisible();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/access-status$/);
    await page.getByRole("button", { name: "Cek lagi" }).click();
    await expect(page.getByText("Belum terverifikasi")).toBeVisible();
    await expect(page.getByRole("link", { name: /Hubungi CS di WhatsApp/ })).toBeVisible();
  });

  test("OPS-03: no active access says so, and 'Pakai email lain' signs out", async ({ page }) => {
    await asVisitor(page, "Masuk, tanpa akses aktif");
    await expect(page).toHaveURL(/\/access-status$/);
    await expect(page.getByText("Belum ada akses aktif untuk email ini")).toBeVisible();
    await page.getByRole("button", { name: "Pakai email lain" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("session expired: explains and offers to sign in again", async ({ page }) => {
    await asVisitor(page, "Sesi berakhir");
    await expect(page).toHaveURL(/\/access-status$/);
    await expect(page.getByText("Sesimu sudah berakhir")).toBeVisible();
    await page.getByRole("link", { name: "Masuk lagi" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a user who has not finished onboarding is sent to /onboarding", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard Istiqomah" })).toBeVisible();
    await page.getByRole("button", { name: "Buka alat demo" }).click();
    await page.getByLabel("Skenario", { exact: true }).selectOption({ label: "Belum onboarding" });
    await page.getByRole("button", { name: "Muat skenario", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.goto("/worship");
    await expect(page).toHaveURL(/\/onboarding$/);
  });
});

test.describe("accessibility", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`axe: sign-in routes have no serious or critical violations (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
      await asVisitor(page);
      const check = async (name: string) => {
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
        const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(bad.map((v) => `${name}: ${v.id} ${v.nodes.length}`)).toEqual([]);
      };
      await check("/login");
      await requestCode(page, DEMO_EMAIL);
      await page.getByText("Tidak menerima kode?").click();
      await check("/auth/verify");
      await page.getByLabel("Kode 6 digit").fill("000000");
      await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
      await check("/auth/verify (error)");
      await page.goto("/login");
      await setAccountState(page, "Belum masuk, akun sudah di 3 perangkat");
      await signIn(page, DEMO_EMAIL);
      await check("/auth/verify (device limit)");
      await setAccountState(page, "Masuk, pembelian belum terverifikasi");
      await expect(page).toHaveURL(/\/access-status$/);
      await check("/access-status (pending)");
      await setAccountState(page, "Masuk, tanpa akses aktif");
      await expect(page.getByText("Belum ada akses aktif untuk email ini")).toBeVisible();
      await check("/access-status (no access)");
      await setAccountState(page, "Sesi berakhir");
      await expect(page.getByText("Sesimu sudah berakhir")).toBeVisible();
      await check("/access-status (expired)");
    });
  }

  test("no horizontal scroll on the new screens", async ({ page }) => {
    await asVisitor(page);
    await page.goto("/login");
    for (const path of ["/login", "/access-status"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
    await requestCode(page, FRESH_EMAIL);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
  });
});
