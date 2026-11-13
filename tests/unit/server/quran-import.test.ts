import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSurahFiles,
  parseQuranData,
  surahFileName,
  verifyMetadata,
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

describe("QURAN-05 seluruh surah dan metadata", () => {
  const publicDir = join(process.cwd(), "public", "quran");
  const metaSrc = readFileSync(join(dir, "source", "quran-data.js"), "utf8");
  const metaBuf = readFileSync(join(dir, "source", "quran-data.js"));

  it("checksum metadata cocok dengan SOURCE.md dan meta.json", () => {
    const sha = sha256Hex(metaBuf);
    expect(sourceMd).toContain(sha);
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as { sha256: string; textSha256: string };
    expect(meta.sha256).toBe(sha);
    expect(meta.textSha256).toBe(sha256Hex(sourceBuf));
    expect(sourceMd).toContain("https://tanzil.net/res/text/metadata/quran-data.js");
  });

  it("parseQuranData membaca 114 surah, 30 juz, 604 halaman tanpa mengeksekusi file", () => {
    const m = parseQuranData(metaSrc);
    verifyMetadata(m);
    expect(m.pages[0]).toEqual([1, 1]);
    expect(m.surahs[0]).toMatchObject({ number: 1, ayahs: 7 });
    expect(m.surahs[113]).toMatchObject({ number: 114, ayahs: 6 });
  });

  it("verifyMetadata menolak data rusak", () => {
    const m = parseQuranData(metaSrc);
    expect(() => verifyMetadata({ ...m, pages: m.pages.slice(1) })).toThrow(/604/);
    expect(() => verifyMetadata({ ...m, juz: m.juz.slice(0, 29) })).toThrow(/30 juz/);
    expect(() => verifyMetadata({ ...m, surahs: m.surahs.slice(0, 113) })).toThrow(/114/);
    expect(() => parseQuranData("var x = 1;")).toThrow(/not found/);
  });

  it("114 file surah: 6236 ayat, sama persis dengan file sumber byte per byte, checksum cocok", () => {
    const all = parseSource(sourceBuf.toString("utf8"));
    const textSha = sha256Hex(sourceBuf);
    let total = 0;
    for (let n = 1; n <= 114; n++) {
      const f = JSON.parse(readFileSync(join(publicDir, surahFileName(n)), "utf8")) as {
        surah: number;
        sha256: string;
        verses: { ayah: number; text: string }[];
      };
      expect(f.surah).toBe(n);
      expect(f.sha256).toBe(textSha);
      const src = all.filter((v) => v.surah === n);
      expect(f.verses).toHaveLength(src.length);
      f.verses.forEach((v, i) => {
        expect(v.ayah).toBe(i + 1);
        expect(Buffer.from(v.text, "utf8").equals(Buffer.from(src[i]!.text, "utf8")), `${n}:${v.ayah}`).toBe(true);
      });
      total += f.verses.length;
    }
    expect(total).toBe(6236);
  });

  it("buildSurahFiles menolak jumlah ayat yang tidak cocok", () => {
    const m = parseQuranData(metaSrc);
    const all = parseSource(sourceBuf.toString("utf8")).filter((v) => !(v.surah === 2 && v.ayah === 286));
    expect(() => buildSurahFiles(all, "x", m)).toThrow(/Surah 2/);
  });
});
