import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_COUNTS,
  extractLicenseBlock,
  parseSource,
  readChecksumFromSourceMd,
  selectWanted,
  sha256Hex,
  verifyCounts,
} from "../../../scripts/import-quran";

const dir = join(process.cwd(), "content", "quran");
const sourceBuf = readFileSync(join(dir, "source", "quran-uthmani.txt"));
const sourceMd = readFileSync(join(dir, "SOURCE.md"), "utf8");
const dataset = JSON.parse(readFileSync(join(dir, "uthmani.json"), "utf8")) as {
  sha256: string;
  verses: { surah: number; ayah: number; text: string }[];
};

describe("QURAN-01 Tanzil import", () => {
  it("has the expected verse count per surah", () => {
    const count = (s: number) => dataset.verses.filter((v) => v.surah === s).length;
    expect(count(18)).toBe(110);
    expect(count(36)).toBe(83);
    expect(count(55)).toBe(78);
    expect(count(56)).toBe(96);
    expect(count(67)).toBe(30);
    expect(count(65)).toBe(2);
    expect(dataset.verses).toHaveLength(399);
    expect(Object.keys(EXPECTED_COUNTS)).toHaveLength(6);
  });

  it("keeps only At-Talaq 2-3", () => {
    const ayat = dataset.verses.filter((v) => v.surah === 65).map((v) => v.ayah);
    expect(ayat).toEqual([2, 3]);
  });

  it("matches the SHA-256 recorded in SOURCE.md and in uthmani.json", () => {
    const sha = sha256Hex(sourceBuf);
    expect(readChecksumFromSourceMd(sourceMd)).toBe(sha);
    expect(dataset.sha256).toBe(sha);
  });

  it("is identical to the source file for every imported verse", () => {
    const all = parseSource(sourceBuf.toString("utf8"));
    expect(all).toHaveLength(6236);
    const bySurahAyah = new Map(all.map((v) => [`${v.surah}:${v.ayah}`, v.text]));
    for (const v of dataset.verses) {
      const original = bySurahAyah.get(`${v.surah}:${v.ayah}`);
      expect(original, `${v.surah}:${v.ayah} missing in source`).toBeDefined();
      expect(Buffer.from(v.text, "utf8").equals(Buffer.from(original as string, "utf8"))).toBe(true);
    }
    expect(selectWanted(all)).toEqual(dataset.verses);
  });

  it("has contiguous ayah numbers", () => {
    for (const s of Object.keys(EXPECTED_COUNTS).map(Number)) {
      const nums = dataset.verses.filter((v) => v.surah === s).map((v) => v.ayah);
      nums.forEach((n, i) => expect(n).toBe(nums[0]! + i));
    }
  });

  it("stores the Tanzil license text in SOURCE.md", () => {
    const license = extractLicenseBlock(sourceBuf.toString("utf8"));
    expect(sourceMd).toContain(license);
    expect(license).toContain("CHANGING IT IS NOT ALLOWED");
    expect(sourceMd).toContain("https://tanzil.net");
  });

  it("rejects a dataset with a wrong verse count", () => {
    const broken = dataset.verses.filter((v) => !(v.surah === 67 && v.ayah === 30));
    expect(() => verifyCounts(broken)).toThrow(/Surah 67/);
  });
});
