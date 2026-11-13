import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seedSignedIn } from "./r3b-fixtures";

test("bantuan: referensi dari konten owner, disclaimer, CS tersembunyi bila env kosong", async ({ page }) => {
  await page.goto("/help");
  await expect(page.getByText("bukan hukum fikih")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Level 1/ })).toBeVisible();
  await expect(page.locator(".arabic").first()).toBeVisible();
  await expect(page.getByText("Draf, belum final")).toBeVisible();
  await expect(page.getByRole("link", { name: /Chat CS/ })).toHaveCount(0);
});

test("profil: ringkasan dan tautan ke halaman turunan", async ({ page }) => {
  await page.goto("/profile");
  for (const name of ["Laporan", "Notifikasi", "Pengaturan", "Perangkat aktif", "Akun dan data", "Bantuan"]) {
    await expect(page.getByRole("main").getByRole("link", { name })).toBeVisible();
  }
  await page.getByRole("link", { name: "Bantuan" }).click();
  await expect(page).toHaveURL(/\/help$/);
});

async function serious(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${label}: ${v.id} ${v.nodes.length} (${v.nodes[0]?.target.join(" ")})`);
}

for (const theme of ["light", "dark"] as const) {
  test(`axe dan overflow: rute T2 (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
    await seedSignedIn(page);
    const routes: [string, string][] = [
      ["/quran", "Mulai target khatam"],
      ["/quran/baca/halaman/1", "Halaman 1"],
      ["/quran/36", "Progres bacaan"],
      ["/reports", "Tingkat tuntas"],
      ["/reports/calendar", "Riwayat istiqomah"],
      ["/settings", "Tampilan"],
      ["/settings/devices", "Perangkat ini"],
      ["/settings/account", "Unduh data"],
      ["/notifications", "Pasang alarm manual"],
      ["/help", "Referensi amalan"],
      ["/profile", "Zona waktu"],
    ];
    const found: string[] = [];
    for (const [path, ready] of routes) {
      await page.goto(path);
      await expect(page.getByText(ready).first()).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      found.push(...(await serious(page, path)));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0);
    }
    expect(found).toEqual([]);
  });
}
