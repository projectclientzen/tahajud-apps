import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { asVisitor, FRESH_EMAIL, signIn } from "./r3a-helpers";

/** A brand new demo user: has access, never onboarded. The first sign-in lands on /onboarding. */
async function freshUser(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as unknown as { __persist: number }).__persist = 0;
    const s = navigator.storage;
    if (s) {
      s.persist = async () => {
        (window as unknown as { __persist: number }).__persist += 1;
        return true;
      };
      s.persisted = async () => false;
    }
  });
  await asVisitor(page);
  await signIn(page, FRESH_EMAIL);
  await expect(page).toHaveURL(/\/onboarding$/);
}

test("first sign-in goes to onboarding and the minimum path is 3 screens to the dashboard", async ({ page }) => {
  await freshUser(page);
  const seen: string[] = [];
  const stepLabel = async () => (await page.getByText(/^Langkah \d dari \d$/).textContent()) ?? "";

  // 1: welcome
  await expect(page.getByRole("heading", { level: 1, name: "Selamat datang di Tahajud Tracker" })).toBeVisible();
  seen.push(await stepLabel());
  await page.getByRole("button", { name: "Mulai" }).click();

  // 2: region (nothing is required beyond picking one)
  await expect(page.getByRole("heading", { level: 1, name: "Pilih wilayah salatmu" })).toBeVisible();
  seen.push(await stepLabel());
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Pilih wilayah dulu");
  await page.getByRole("radio", { name: /Jakarta/ }).check();
  await page.getByRole("button", { name: "Lanjut" }).click();

  // 3: confirm Subuh
  await expect(page.getByRole("heading", { level: 1, name: "Cek jam Subuh" })).toBeVisible();
  seen.push(await stepLabel());
  await expect(page.getByTestId("fajr-confirm")).toHaveText("04.30 WIB");
  await expect(page.getByText("Jadwal contoh, bukan dari Kemenag")).toBeVisible();
  await page.getByRole("button", { name: "Benar, mulai sekarang" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard Istiqomah" })).toBeVisible();
  expect(seen).toEqual(["Langkah 1 dari 3", "Langkah 2 dari 3", "Langkah 3 dari 3"]);

  // The browser was asked to keep the data (PRD §21.1), and onboarding is done for good.
  expect(await page.evaluate(() => (window as unknown as { __persist: number }).__persist)).toBeGreaterThanOrEqual(1);
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("onboarding with a manual schedule", async ({ page }) => {
  await freshUser(page);
  await page.getByRole("button", { name: "Mulai" }).click();
  await page.getByRole("button", { name: "Atur jadwal manual" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Atur jadwal manual" })).toBeVisible();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Isi jam Subuh");
  await page.getByLabel("Zona waktu").selectOption("Asia/Makassar");
  await page.getByLabel("Jam Subuh").fill("04:45");
  await page.getByRole("button", { name: "Lanjut" }).click();
  await expect(page.getByTestId("fajr-confirm")).toHaveText("04.45 WITA");
  await expect(page.getByText("Diatur manual")).toBeVisible();
  await page.getByRole("button", { name: "Benar, mulai sekarang" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("skipped optional steps come back as setup cards on the dashboard", async ({ page }) => {
  await freshUser(page);
  await page.getByRole("button", { name: "Mulai" }).click();
  await page.getByRole("radio", { name: /Jakarta/ }).check();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByRole("button", { name: "Benar, mulai sekarang" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const install = page.getByTestId("setup-install_app");
  await expect(install).toBeVisible();
  await install.getByRole("button", { name: "Lihat caranya" }).click();
  const dialog = page.getByRole("dialog", { name: "Pasang di layar utama" });
  await expect(dialog.getByText("Pasang di perangkatmu")).toBeVisible();
  await expect(dialog.getByRole("list").first()).toBeVisible();
  await page.keyboard.press("Escape");

  // The header carries the notification and profile links (PRD §8.2 A).
  await expect(page.getByRole("main").getByRole("link", { name: "Notifikasi" })).toHaveAttribute(
    "href",
    "/notifications",
  );
  await expect(page.getByRole("main").getByRole("link", { name: "Profil" })).toHaveAttribute("href", "/profile");
});

test("optional steps can each be skipped and end on the dashboard", async ({ page }) => {
  await freshUser(page);
  await page.getByRole("button", { name: "Mulai" }).click();
  await page.getByRole("radio", { name: /Jakarta/ }).check();
  await page.getByRole("button", { name: "Lanjut" }).click();
  await page.getByRole("button", { name: "Atur langkah tambahan dulu" }).click();
  await expect(page).toHaveURL(/\/onboarding\/extra$/);

  await expect(page.getByRole("heading", { level: 1, name: "Kenali tiga level" })).toBeVisible();
  await expect(page.getByText("Level 1: Fondasi")).toBeVisible();
  await page.getByRole("button", { name: "Lewati" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Target jam tidur" })).toBeVisible();
  await page.getByLabel("Target jam tidur").fill("21:30");
  await page.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Tersimpan. Pengingat tidur dihitung dari jam ini.")).toBeVisible();
  await page.getByRole("button", { name: "Lanjut" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Aktifkan pengingat" })).toBeVisible();
  await page.getByRole("button", { name: "Lewati" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Pasang di layar utama" })).toBeVisible();
  await expect(page.getByText("Pasang di perangkatmu")).toBeVisible();
  await page.getByRole("button", { name: "Selesai, ke dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: onboarding routes have no serious or critical violations (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
    await freshUser(page);
    const check = async (name: string) => {
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
      const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${name}: ${v.id} ${v.nodes.length}`)).toEqual([]);
    };
    await check("/onboarding (welcome)");
    await page.getByRole("button", { name: "Mulai" }).click();
    await check("/onboarding (region)");
    await page.getByRole("button", { name: "Atur jadwal manual" }).click();
    await check("/onboarding (manual)");
    await page.getByRole("button", { name: "Pilih dari daftar wilayah" }).click();
    await page.getByRole("radio", { name: /Jakarta/ }).check();
    await page.getByRole("button", { name: "Lanjut" }).click();
    await check("/onboarding (confirm)");
    await page.getByRole("button", { name: "Atur langkah tambahan dulu" }).click();
    for (const step of ["levels", "sleep", "notifications", "install"]) {
      await check(`/onboarding/extra (${step})`);
      if (step !== "install")
        await page
          .getByRole("button", { name: /^(Lanjut|Lewati)$/ })
          .first()
          .click();
    }
    await page.getByRole("button", { name: "Selesai, ke dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId("setup-install_app")).toBeVisible();
    await check("/dashboard (setup cards)");
  });
}
