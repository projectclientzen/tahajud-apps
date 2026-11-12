import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASMALAH, buildSurahText, createDatasetQuranText, QURAN_ATTRIBUTION, type QuranDataset } from "@/data/quran";
import { SURAHS } from "@/components/quran/surahs";
import basmalahFile from "@content/quran/basmalah.json";

const dir = join(process.cwd(), "content", "quran");
const sourceLines = readFileSync(join(dir, "source", "quran-uthmani.txt"), "utf8").split("\n");
const dataset = JSON.parse(readFileSync(join(dir, "uthmani.json"), "utf8")) as QuranDataset;
const sourceMd = readFileSync(join(dir, "SOURCE.md"), "utf8");

const sourceText = (surah: number, ayah: number) => {
  const line = sourceLines.find((l) => l.startsWith(`${surah}|${ayah}|`));
  if (!line) throw new Error(`missing ${surah}:${ayah}`);
  return line.slice(`${surah}|${ayah}|`.length);
};
const same = (a: string, b: string) => Buffer.from(a, "utf8").equals(Buffer.from(b, "utf8"));

describe("QURAN-03 teks ayat untuk Reader", () => {
  it("basmalah sama persis dengan ayat 1:1 di file sumber Tanzil, dan checksum file cocok", () => {
    expect(same(BASMALAH, sourceText(1, 1))).toBe(true);
    expect(basmalahFile.sha256).toBe(dataset.sha256);
    expect(basmalahFile.reference).toBe("1:1");
  });

  it.each(SURAHS.map((s) => [s.name, s.number] as const))(
    "%s: teks tampil sama dengan sumber, byte per byte",
    (_name, n) => {
      const t = buildSurahText(dataset, n)!;
      expect(t.verses.length).toBe(dataset.verses.filter((v) => v.surah === n).length);
      t.verses.forEach((v, i) => {
        const original = sourceText(n, v.number);
        const shown = i === 0 && t.opening ? `${t.opening} ${v.text}` : v.text;
        expect(same(shown, original), `${n}:${v.number}`).toBe(true);
      });
    },
  );

  it("basmalah jadi baris pembuka untuk 18, 36, 55, 56, 67 dan awalan dilepas dari ayat 1", () => {
    for (const n of [18, 36, 55, 56, 67]) {
      const t = buildSurahText(dataset, n)!;
      expect(t.opening, `surah ${n}`).toBe(BASMALAH);
      expect(t.verses[0]!.number).toBe(1);
      expect(t.verses[0]!.text.startsWith(BASMALAH)).toBe(false);
      expect(t.verses[0]!.text.length).toBeGreaterThan(0);
    }
  });

  it("At-Talaq 65:2-3 tanpa basmalah dan ayatnya utuh", () => {
    const t = buildSurahText(dataset, 65)!;
    expect(t.opening).toBeNull();
    expect(t.verses.map((v) => v.number)).toEqual([2, 3]);
    expect(same(t.verses[0]!.text, sourceText(65, 2))).toBe(true);
  });

  it("awalan yang tidak sama persis tidak dilepas (ayat tetap utuh, tanpa baris pembuka)", () => {
    const base = BASMALAH;
    const cases = [
      `${base}x tail`, // no space after the prefix
      `${base.slice(0, -1)} tail`, // prefix differs by one character
      `${base}  tail`.replace(`${base} `, `${base} `), // non-breaking space instead of space
    ];
    for (const text of cases) {
      const t = buildSurahText({ source: "t", sha256: "x", verses: [{ surah: 36, ayah: 1, text }] }, 36)!;
      expect(t.opening).toBeNull();
      expect(t.verses[0]!.text).toBe(text);
    }
  });

  it("surah tanpa data mengembalikan null, bukan teks buatan", () => {
    expect(buildSurahText(dataset, 1)).toBeNull();
    expect(buildSurahText({ source: "t", sha256: "x", verses: [] }, 36)).toBeNull();
  });

  it("repository: gagal muat mengembalikan null lalu pulih saat dicoba lagi", async () => {
    let calls = 0;
    const repo = createDatasetQuranText(async () => {
      calls += 1;
      if (calls === 1) throw new Error("chunk failed");
      return dataset;
    });
    expect(await repo.getSurah(36)).toBeNull();
    expect((await repo.getSurah(36))?.verses).toHaveLength(83);
    expect(calls).toBe(2);
  });

  it("repository memuat dataset asli dari content/quran lewat chunk terpisah", async () => {
    const t = await createDatasetQuranText().getSurah(18);
    expect(t?.verses).toHaveLength(110);
    expect(t?.opening).toBe(BASMALAH);
  });

  it("atribusi Tanzil sesuai SOURCE.md", () => {
    expect(QURAN_ATTRIBUTION.sourceUrl).toBe("https://tanzil.net");
    expect(QURAN_ATTRIBUTION.licenseUrl).toBe("https://tanzil.net/docs/Text_License");
    expect(sourceMd).toContain(QURAN_ATTRIBUTION.sourceUrl);
    expect(sourceMd).toContain(QURAN_ATTRIBUTION.licenseUrl);
    expect(sourceMd).toContain(QURAN_ATTRIBUTION.licenseName);
  });
});
