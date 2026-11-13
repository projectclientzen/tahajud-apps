import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFullQuranText, mushaf, surahFileUrl, type FetchLike } from "@/data/quran";

const fromDisk: FetchLike = async (url) => {
  const path = join(process.cwd(), "public", url);
  try {
    const body = JSON.parse(readFileSync(path, "utf8"));
    return { ok: true, json: async () => body };
  } catch {
    return { ok: false, json: async () => null };
  }
};

describe("QURAN-06 pembaca penuh", () => {
  it("Al-Fatihah: ayat 1 adalah basmalah itu sendiri, tidak dipisah, 7 ayat", async () => {
    const t = (await createFullQuranText(fromDisk).getSurah(1))!;
    expect(t.opening).toBeNull();
    expect(t.verses.map((v) => v.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("surah biasa: basmalah jadi baris pembuka, ayat 1 utuh di sisa teks", async () => {
    const t = (await createFullQuranText(fromDisk).getSurah(2))!;
    expect(t.opening).not.toBeNull();
    expect(t.verses).toHaveLength(286);
    expect(`${t.opening} ${t.verses[0]!.text}`).toBe(
      JSON.parse(readFileSync(join(process.cwd(), "public", surahFileUrl(2)), "utf8")).verses[0].text,
    );
  });

  it("segmen halaman 604 memuat tiga surah pendek berurutan", async () => {
    const seg = (await createFullQuranText(fromDisk).getSegments(mushaf.pageRanges(604)))!;
    expect(seg.map((s) => s.surah)).toEqual([112, 113, 114]);
    expect(seg.map((s) => s.verses.length)).toEqual([4, 5, 6]);
    expect(seg.every((s) => s.starts)).toBe(true);
  });

  it("file hilang, rusak, atau salah jumlah ayat = null, bukan teks buatan", async () => {
    const missing = createFullQuranText(async () => ({ ok: false, json: async () => null }));
    expect(await missing.getSurah(1)).toBeNull();
    const broken = createFullQuranText(async () => ({ ok: true, json: async () => ({ surah: 1, verses: [] }) }));
    expect(await broken.getSurah(1)).toBeNull();
    const throws = createFullQuranText(async () => {
      throw new Error("offline");
    });
    expect(await throws.getSurah(1)).toBeNull();
    expect(await throws.getSegments(mushaf.pageRanges(1))).toBeNull();
    expect(await createFullQuranText(fromDisk).getSurah(115)).toBeNull();
  });

  it("surah gagal dimuat tidak disimpan di cache, percobaan berikutnya berhasil", async () => {
    let fail = true;
    const repo = createFullQuranText(async (url) => (fail ? { ok: false, json: async () => null } : fromDisk(url)));
    expect(await repo.getSurah(1)).toBeNull();
    fail = false;
    expect(await repo.getSurah(1)).not.toBeNull();
  });
});
