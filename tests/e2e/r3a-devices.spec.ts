import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_EMAIL, finishOnboarding, readOtp, requestCode } from "./r3a-helpers";
import { startSession, withDevPanel } from "./s3-helpers";

/** Picks a sign-in scenario in the demo tools on the sign-in screens. */
async function loadAuthScenario(page: Page, label: string) {
  await page.getByRole("button", { name: "Buka alat demo masuk" }).click();
  const dialog = page.getByRole("dialog", { name: "Alat demo masuk" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Skenario masuk").selectOption({ label });
  await dialog.getByRole("button", { name: "Muat skenario" }).click();
  await expect(dialog.getByText(/dimuat/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

/** Types the code and presses Masuk. */
async function submitCode(page: Page, email: string) {
  const code = await readOtp(page, email);
  await page.getByLabel("Kode 6 digit").fill(code);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
}

/** Signed out, and the demo account already has 3 active devices. Ends on the screen after the right code. */
async function reachDeviceLimit(page: Page) {
  await page.goto("/login");
  await loadAuthScenario(page, "Belum masuk, akun sudah di 3 perangkat");
  await requestCode(page, DEMO_EMAIL);
  await submitCode(page, DEMO_EMAIL);
  await expect(
    page.getByRole("heading", { name: "Akunmu sudah aktif di 3 perangkat (maksimal)", level: 1 }),
  ).toBeVisible();
}

test.describe("batas 3 perangkat (PRD §24.1)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("AUTH-DEVICE: perangkat ke-4 ditolak setelah kode benar, daftar tampil, tidak ada yang dikeluarkan otomatis", async ({
    page,
  }) => {
    await reachDeviceLimit(page);
    await expect(page.getByRole("radio")).toHaveCount(3);
    await expect(page.getByText("Contoh: iPhone Safari")).toBeVisible();
    await expect(page.getByText("Contoh: Laptop Firefox")).toBeVisible();
    await expect(page.getByText("Contoh: Android Chrome")).toBeVisible();
    await expect(page.getByText(/Terakhir aktif/).first()).toBeVisible();
    const go = page.getByRole("button", { name: /Keluarkan perangkat ini dan lanjut masuk/ });
    await expect(go).toBeDisabled();
    // No session was created: the app stays closed.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("AUTH-DEVICE: user memilih satu perangkat, perangkat itu keluar, login lanjut", async ({ page }) => {
    await reachDeviceLimit(page);
    await page.getByRole("radio", { name: /Contoh: Laptop Firefox/ }).check();
    await page.getByRole("button", { name: /Keluarkan perangkat ini dan lanjut masuk/ }).click();
    // The demo account is new on this browser, so the gates send it through onboarding first.
    await finishOnboarding(page);
    await page.goto("/settings/devices");
    await expect(page.getByText("Perangkat ini", { exact: true })).toBeVisible();
    await expect(page.getByText("Contoh: iPhone Safari")).toBeVisible();
    await expect(page.getByText("Contoh: Android Chrome")).toBeVisible();
    await expect(page.getByText("Contoh: Laptop Firefox")).toHaveCount(0);
  });

  test("AUTH-DEVICE: batal kembali ke login dan user tetap keluar", async ({ page }) => {
    await reachDeviceLimit(page);
    await page.getByRole("button", { name: "Batal" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("layar batas perangkat tidak punya masalah aksesibilitas serious/critical (terang dan gelap)", async ({
    page,
  }) => {
    for (const theme of ["light", "dark"]) {
      await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
      await reachDeviceLimit(page);
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      expect(
        violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${theme}: ${v.id}`),
      ).toEqual([]);
    }
  });
});

test("sesi yang dicabut dari perangkat lain kembali ke /login dengan pesan yang jelas", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Subuh berikutnya")).toBeVisible();
  // Another device signed this one out: mark this device revoked in the mock sign-in state.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("tahajud-auth-mock", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const store = (mode: IDBTransactionMode) => db.transaction("state", mode).objectStore("state");
    const state = await new Promise<{
      session: { userId: string; deviceId: string };
      devices: Record<string, { id: string; revokedAt: number | null }[]>;
    }>((resolve) => {
      const r = store("readonly").get("auth");
      r.onsuccess = () => resolve(r.result);
    });
    state.devices[state.session.userId]!.find((d) => d.id === state.session.deviceId)!.revokedAt = Date.now();
    await new Promise<void>((resolve) => {
      const w = store("readwrite").put(state, "auth");
      w.onsuccess = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("status").filter({ hasText: "dikeluarkan dari akunmu" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible(); // the way back in is right there
});

test("DZIKIR-02: centang salat lewat antrean offline, bertahan setelah reload, terkirim sekali saat server kembali", async ({
  page,
}) => {
  await startSession(page);
  await withDevPanel(page, async () => {
    await page.getByLabel("Simulasi offline").check();
  });
  const taubat = page.getByRole("checkbox", { name: /Salat Taubat/ });
  await taubat.check();
  await expect(taubat).toBeChecked();

  // The tick lives in the offline queue (IndexedDB), so a reload still shows it.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /Salat Taubat/ })).toBeChecked();

  await withDevPanel(page, async () => {
    await page.getByLabel("Simulasi offline").uncheck();
  });
  await page.goto("/dashboard");
  await expect(page.getByTestId("required-progress")).toContainText("1 dari", { timeout: 15_000 });
  await page.goto("/worship/session");
  await expect(page.getByRole("checkbox", { name: /Salat Taubat/ })).toBeChecked();

  // Nothing waits in the queue any more: signing out asks no questions about notes.
  await page.getByRole("button", { name: "Keluar" }).filter({ visible: true }).first().click();
  await expect(page.getByTestId("logout-warning")).toHaveCount(0);
});

test("centang dan lepas centang saat offline tidak menyisakan dobel di server", async ({ page }) => {
  await startSession(page);
  await withDevPanel(page, async () => {
    await page.getByLabel("Simulasi offline").check();
  });
  const taubat = page.getByRole("checkbox", { name: /Salat Taubat/ });
  await taubat.check();
  await taubat.uncheck();
  await taubat.check();
  await withDevPanel(page, async () => {
    await page.getByLabel("Simulasi offline").uncheck();
  });
  await page.goto("/dashboard");
  await expect(page.getByTestId("required-progress")).toContainText("1 dari", { timeout: 15_000 });
});

test("SECURITY-06: keluar menghapus pengaturan perencana (tt-planner-prefs) tetapi tema tetap", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByText("Subuh berikutnya")).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem(
      "tt-planner-prefs",
      JSON.stringify({ provisional: true, durations: { 1: 90 }, bufferMinutes: 15 }),
    );
    localStorage.setItem("tt-theme", "dark");
  });
  await page.getByRole("button", { name: "Keluar" }).filter({ visible: true }).first().click();
  await page
    .getByRole("dialog", { name: "Keluar dari perangkat ini?" })
    .getByRole("button", { name: "Keluar", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem("tt-planner-prefs"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("tt-theme"))).toBe("dark");
  // A plain sign-out says nothing about devices.
  await expect(page.getByText("dikeluarkan dari akunmu")).toHaveCount(0);
});

test("header dashboard: tautan notifikasi, laporan, pengaturan, dan profil", async ({ page }) => {
  await page.goto("/dashboard");
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Notifikasi" })).toHaveAttribute("href", "/notifications");
  await expect(main.getByRole("link", { name: "Laporan" })).toHaveAttribute("href", "/reports");
  await expect(main.getByRole("link", { name: "Pengaturan" })).toHaveAttribute("href", "/settings");
  await expect(main.getByRole("link", { name: "Profil" })).toHaveAttribute("href", "/profile");
  await main.getByRole("link", { name: "Laporan" }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await page.goBack();
  await main.getByRole("link", { name: "Pengaturan" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
