import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/** Source of truth for the byte-for-byte comparison: the downloaded Tanzil file, not the app's own JSON. */
const sourceLines = readFileSync("content/quran/source/quran-uthmani.txt", "utf8").split("\n");
const sourceText = (surah: number, ayah: number): string => {
  const prefix = `${surah}|${ayah}|`;
  const line = sourceLines.find((l) => l.startsWith(prefix));
  if (!line) throw new Error(`missing ${prefix}`);
  return line.slice(prefix.length);
};
const sourceBasmalah = sourceText(1, 1);

const READINGS = [
  { number: 36, name: "Yasin", first: 1, last: 83 },
  { number: 56, name: "Al-Waqi'ah", first: 1, last: 96 },
  { number: 67, name: "Al-Mulk", first: 1, last: 30 },
  { number: 55, name: "Ar-Rahman", first: 1, last: 78 },
  { number: 18, name: "Al-Kahfi", first: 1, last: 110 },
  { number: 65, name: "At-Talaq", first: 2, last: 3 },
];

for (const r of READINGS) {
  test(`QURAN-03: ${r.name} tampil sama dengan sumber Tanzil (byte per byte)`, async ({ page }) => {
    await page.goto(`/quran/${r.number}`);
    const ayat = page.locator("[data-ayah]");
    await expect(ayat).toHaveCount(r.last - r.first + 1);

    const shown = await ayat.evaluateAll((els) =>
      els.map((e) => ({ n: Number((e as HTMLElement).dataset.ayah), text: e.textContent ?? "" })),
    );
    const basmalah = await page.getByTestId("basmalah").allTextContents();

    if (r.number === 65) {
      expect(basmalah).toEqual([]);
    } else {
      expect(basmalah).toHaveLength(1);
      expect(Buffer.from(basmalah[0]!, "utf8").equals(Buffer.from(sourceBasmalah, "utf8"))).toBe(true);
    }
    shown.forEach((v, i) => {
      expect(v.n).toBe(r.first + i);
      const original = sourceText(r.number, v.n);
      // Ayah 1 lost its basmalah prefix to the opening line. Rejoining must give the source text back.
      const rejoined = i === 0 && r.number !== 65 ? `${basmalah[0]} ${v.text}` : v.text;
      expect(Buffer.from(rejoined, "utf8").equals(Buffer.from(original, "utf8")), `${r.number}:${v.n}`).toBe(true);
    });
  });
}

test("atribusi Tanzil tampil di akhir surah dengan tautan ke tanzil.net", async ({ page }) => {
  await page.goto("/quran/18");
  const last = page.locator("[data-ayah]").last();
  const attribution = page.getByTestId("quran-attribution");
  await expect(attribution).toContainText("Tanzil Project");
  await expect(attribution.getByRole("link", { name: "tanzil.net" })).toHaveAttribute("href", "https://tanzil.net");
  await expect(attribution.getByRole("link", { name: /Creative Commons/ })).toHaveAttribute(
    "href",
    "https://tanzil.net/docs/Text_License",
  );
  const [aBox, lBox] = [await attribution.boundingBox(), await last.boundingBox()];
  expect(aBox!.y).toBeGreaterThan(lBox!.y);
});

test("tidak ada terjemahan dan teks tidak diubah gaya: hanya Arab di dalam ayat", async ({ page }) => {
  await page.goto("/quran/67");
  await expect(page.locator("[data-ayah]").first()).toBeVisible();
  const langs = await page.locator("[data-ayah]").evaluateAll((els) => els.map((e) => e.getAttribute("lang")));
  expect(new Set(langs)).toEqual(new Set(["ar"]));
  await expect(page.locator("[data-ayah]").first()).toHaveCSS("direction", "rtl");
});

test("font Amiri Quran termuat dan dipakai di Yasin dan Al-Kahfi", async ({ page }) => {
  for (const n of [36, 18]) {
    await page.goto(`/quran/${n}`);
    await expect(page.locator("[data-ayah]").first()).toBeVisible();
    const ok = await page.evaluate(async () => {
      await document.fonts.ready;
      const faces = [...document.fonts].filter((f) => f.family.includes("Amiri Quran"));
      return { loaded: faces.some((f) => f.status === "loaded"), count: faces.length };
    });
    expect(ok.count, `surah ${n}: Amiri Quran face missing`).toBeGreaterThan(0);
    expect(ok.loaded, `surah ${n}: Amiri Quran not loaded`).toBe(true);
  }
});

for (const [name, size] of [
  ["Yasin", 36],
  ["Al-Kahfi", 18],
] as const) {
  test(`${name}: tidak ada luapan horizontal pada 320px dan huruf terbesar`, async ({ page }) => {
    await page.goto(`/quran/${size}`);
    await expect(page.locator("[data-ayah]").first()).toBeVisible();
    for (let i = 0; i < 10; i++) {
      const plus = page.getByRole("button", { name: "Perbesar huruf" });
      if (await plus.isDisabled()) break;
      await plus.click();
    }
    await expect(page.getByTestId("reader-font")).toHaveText("44 px");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    // No ayah text may be clipped by its row.
    const clipped = await page
      .locator("[data-ayah]")
      .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
    expect(clipped).toBe(0);
  });
}
