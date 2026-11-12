import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loadScenario } from "./s3-helpers";

async function serious(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${label}: ${v.id} ${v.nodes.length} (${v.nodes[0]?.target.join(" ")})`);
}

for (const theme of ["light", "dark"] as const) {
  test(`axe dan overflow: reader semua surah dan keadaan terbuka (${theme})`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript((t) => localStorage.setItem("tt-theme", t), theme);
    const found: string[] = [];
    for (const n of [18, 36, 55, 56, 65, 67]) {
      await page.goto(`/quran/${n}`);
      await expect(page.locator("[data-ayah]").first()).toBeVisible();
      await page
        .getByRole("button", { name: /Tandai ayat \d+ sebagai/ })
        .first()
        .click();
      found.push(...(await serious(page, `/quran/${n}`)));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `/quran/${n} overflows horizontally`).toBeLessThanOrEqual(0);
    }
    await page.goto("/help");
    for (const s of await page.locator("summary").all()) await s.click();
    found.push(...(await serious(page, "/help (semua level dibuka)")));
    await page.goto("/reports");
    await loadScenario(page, "Lima malam tuntas");
    await page.getByRole("button", { name: /Tampilkan semua/ }).click();
    found.push(...(await serious(page, "/reports (daftar lengkap)")));
    expect(found).toEqual([]);
  });
}

test("bantuan: level dilipat, Level 1 terbuka, bisa dibuka dengan keyboard", async ({ page }) => {
  await page.goto("/help");
  const l1 = page.locator("details").nth(0);
  const l2 = page.locator("details").nth(1);
  await expect(l1).toHaveAttribute("open", "");
  await expect(l2).not.toHaveAttribute("open", "");
  await page.locator("summary").nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(l2).toHaveAttribute("open", "");
});

test("laporan: daftar amalan dilipat lalu dibuka semua", async ({ page }) => {
  await page.goto("/reports");
  await loadScenario(page, "Lima malam tuntas");
  const toggle = page.getByRole("button", { name: /Tampilkan semua \d+ amalan/ });
  await expect(toggle).toBeVisible();
  const before = await page.getByRole("progressbar").count();
  await toggle.click();
  await expect(page.getByRole("button", { name: "Tampilkan lebih sedikit" })).toHaveAttribute("aria-expanded", "true");
  expect(await page.getByRole("progressbar").count()).toBeGreaterThan(before);
});

test("pengaturan: tautan bagian memindahkan ke seksi yang ada", async ({ page }) => {
  await page.goto("/settings");
  const nav = page.getByRole("navigation", { name: "Bagian pengaturan" });
  for (const [label, id] of [
    ["Jam bangun", "jam-bangun"],
    ["Pengingat", "pengingat"],
    ["Wilayah", "wilayah"],
    ["Tampilan", "tampilan"],
  ] as const) {
    await nav.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
});

test("jadwal di Pengaturan: mode demo tidak pernah berlabel terverifikasi dan tanpa atribusi Kemenag", async ({
  page,
}) => {
  await page.goto("/settings");
  const note = page.getByTestId("schedule-note");
  await expect(note).toContainText("Belum diverifikasi");
  await expect(note).toContainText("bukan dari Kemenag");
  await expect(note).not.toContainText("Terverifikasi");
  await expect(note).not.toContainText("Bimas Islam");
});

test("jadwal di Notifikasi menampilkan label yang sama", async ({ page }) => {
  await page.goto("/notifications");
  await expect(page.getByTestId("schedule-note")).toContainText("Belum diverifikasi");
});
