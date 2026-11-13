import { describe, expect, it } from "vitest";
import {
  adjustmentFor,
  computeKhatam,
  dayNumber,
  dayPages,
  endDateOf,
  KHATAM_DAYS,
  MUSHAF_PAGES,
  pagesDueThrough,
  pagesRead,
  positionAfterMark,
  PRAYERS,
  slotPages,
  totalPages,
  type KhatamState,
  type SlotRead,
} from "@/domain/khatam";

const WIB = "Asia/Jakarta";
const WITA = "Asia/Makassar";
const WIT = "Asia/Jayapura";
// 2026-11-17 is a Tuesday. Instants are given in UTC.
const state = (over: Partial<KhatamState> = {}): KhatamState => ({
  khatamCount: 1,
  startDate: "2026-11-17",
  timezone: WIB,
  adjustment: 0,
  reads: [],
  ...over,
});

describe("KHATAM rencana 30 hari", () => {
  it("N=1: 4 halaman per waktu salat, 20 per hari", () => {
    expect(slotPages(1, 1, "subuh")).toBe(4);
    expect(slotPages(1, 29, "isya")).toBe(4);
    expect(dayPages(1, 1)).toBe(20);
  });

  it("N=5: 20 halaman per waktu salat = 1 juz, 100 per hari", () => {
    expect(slotPages(5, 10, "ashar")).toBe(20);
    expect(dayPages(5, 10)).toBe(100);
  });

  it.each([1, 2, 3, 4, 5])("N=%i: total 30 hari tepat 604N, sisa 4N masuk hari terakhir", (n) => {
    expect(pagesDueThrough(n, KHATAM_DAYS)).toBe(MUSHAF_PAGES * n);
    expect(pagesDueThrough(n, 29)).toBe(580 * n);
    expect(dayPages(n, 30)).toBe(24 * n);
    expect(totalPages(n)).toBe(604 * n);
  });

  it("hari terakhir dibagi merata, waktu salat awal mengambil sisa pembagian", () => {
    expect(PRAYERS.map((p) => slotPages(1, 30, p))).toEqual([5, 5, 5, 5, 4]);
    expect(PRAYERS.map((p) => slotPages(5, 30, p))).toEqual([24, 24, 24, 24, 24]);
    expect(PRAYERS.map((p) => slotPages(2, 30, p))).toEqual([10, 10, 10, 9, 9]);
  });

  it("menolak N dan hari di luar batas", () => {
    expect(() => slotPages(0, 1, "subuh")).toThrow(RangeError);
    expect(() => slotPages(6, 1, "subuh")).toThrow(RangeError);
    expect(() => slotPages(1.5, 1, "subuh")).toThrow(RangeError);
    expect(() => slotPages(1, 0, "subuh")).toThrow(RangeError);
    expect(() => slotPages(1, 31, "subuh")).toThrow(RangeError);
    expect(() => pagesDueThrough(1, -1)).toThrow(RangeError);
    expect(pagesDueThrough(1, 0)).toBe(0);
    expect(pagesDueThrough(1, 99)).toBe(604);
  });
});

describe("KHATAM hari dan zona waktu", () => {
  it("tanggal mulai 17 Nov: hari 1 sampai 30, berakhir 16 Des", () => {
    expect(endDateOf("2026-11-17")).toBe("2026-12-16");
    expect(dayNumber("2026-11-17", new Date("2026-11-17T01:00:00Z"), WIB)).toBe(1);
    expect(dayNumber("2026-11-17", new Date("2026-12-16T16:59:00Z"), WIB)).toBe(30);
    expect(dayNumber("2026-11-17", new Date("2026-12-16T17:00:00Z"), WIB)).toBe(31);
  });

  it("pergantian hari mengikuti zona wilayah: instant yang sama, hari berbeda di WIB, WITA, WIT", () => {
    // 2026-11-17 16:30 UTC = 23:30 WIB (17 Nov), 00:30 WITA (18 Nov), 01:30 WIT (18 Nov).
    const t = new Date("2026-11-17T16:30:00Z");
    expect(dayNumber("2026-11-17", t, WIB)).toBe(1);
    expect(dayNumber("2026-11-17", t, WITA)).toBe(2);
    expect(dayNumber("2026-11-17", t, WIT)).toBe(2);
    // 2026-11-17 17:30 UTC = 00:30 WIB (18 Nov): now WIB also moves on.
    expect(dayNumber("2026-11-17", new Date("2026-11-17T17:30:00Z"), WIB)).toBe(2);
  });

  it("computeKhatam memakai zona di state, bukan zona mesin", () => {
    const t = new Date("2026-11-17T16:30:00Z");
    expect(computeKhatam(state({ timezone: WIB }), t).day).toBe(1);
    expect(computeKhatam(state({ timezone: WITA }), t).day).toBe(2);
  });
});

describe("KHATAM progres dan checklist", () => {
  const now = new Date("2026-11-17T05:00:00Z"); // 12:00 WIB, day 1

  it("target baru: 0 persen, halaman berikutnya 1, lima slot belum dicentang dari halaman 1", () => {
    const v = computeKhatam(state(), now);
    expect(v).toMatchObject({
      status: "active",
      day: 1,
      daysLeft: 30,
      pagesRead: 0,
      pagesLeft: 604,
      percent: 0,
      khatamNumber: 1,
      completedKhatam: 0,
      currentPage: 1,
      dueToday: 20,
      carriedOver: 0,
    });
    expect(v.today.map((s) => [s.prayer, s.pages, s.done, s.fromPage, s.toPage])).toEqual([
      ["subuh", 4, false, 1, 4],
      ["dzuhur", 4, false, 5, 8],
      ["ashar", 4, false, 9, 12],
      ["maghrib", 4, false, 13, 16],
      ["isya", 4, false, 17, 20],
    ]);
  });

  it("centang satu slot menambah halaman slot itu; slot sisanya mulai dari posisi terakhir", () => {
    const reads: SlotRead[] = [{ day: 1, prayer: "subuh", pages: 4 }];
    const v = computeKhatam(state({ reads }), now);
    expect(v.pagesRead).toBe(4);
    expect(v.currentPage).toBe(5);
    expect(v.today[0]).toMatchObject({ done: true, fromPage: null });
    expect(v.today[1]).toMatchObject({ prayer: "dzuhur", fromPage: 5, toPage: 8 });
  });

  it("urutan centang tidak mengubah jumlah halaman", () => {
    const reads: SlotRead[] = [
      { day: 1, prayer: "isya", pages: 4 },
      { day: 1, prayer: "subuh", pages: 4 },
    ];
    expect(pagesRead(state({ reads }))).toBe(8);
  });

  it("N=5: khatam kedua mulai setelah halaman 604, penunjuk halaman membungkus ke 1", () => {
    const v = computeKhatam(state({ khatamCount: 5, adjustment: 610 }), now);
    expect(v.khatamNumber).toBe(2);
    expect(v.completedKhatam).toBe(1);
    expect(v.currentPage).toBe(7);
  });

  it("slot yang melewati halaman 604 membungkus ke halaman 1", () => {
    const v = computeKhatam(state({ khatamCount: 2, adjustment: 602 }), now);
    expect(v.today[0]).toMatchObject({ fromPage: 603, toPage: 6 });
  });

  it("selesai: total terbaca, status completed, tanpa slot dan tanpa halaman berikutnya", () => {
    const v = computeKhatam(state({ adjustment: 604 }), now);
    expect(v).toMatchObject({ status: "completed", pagesLeft: 0, percent: 100, currentPage: null, daysLeft: 0, khatamNumber: 1 });
    expect(v.today).toEqual([]);
  });

  it("progres tidak melewati total dan tidak negatif", () => {
    expect(pagesRead(state({ adjustment: 9999 }))).toBe(604);
    expect(pagesRead(state({ adjustment: -50 }))).toBe(0);
  });

  it("persen satu desimal", () => {
    expect(computeKhatam(state({ adjustment: 1 }), now).percent).toBe(0.2);
    expect(computeKhatam(state({ adjustment: 302 }), now).percent).toBe(50);
  });
});

describe("KHATAM hari terlewat: tanpa reset, tanpa menyalahkan", () => {
  it("hari 4 tanpa baca: sisa dari hari sebelumnya 60, progres tetap, rencana hari ini 20", () => {
    const day4 = new Date("2026-11-20T05:00:00Z");
    const v = computeKhatam(state(), day4);
    expect(v).toMatchObject({ day: 4, status: "active", carriedOver: 60, dueToday: 80, pagesRead: 0, daysLeft: 27 });
    expect(v.today).toHaveLength(5);
  });

  it("membaca lebih dulu tidak membuat sisa negatif", () => {
    const v = computeKhatam(state({ adjustment: 200 }), new Date("2026-11-18T05:00:00Z"));
    expect(v.carriedOver).toBe(0);
  });

  it("slot hari lalu yang dicentang tetap dihitung (antrean offline yang terlambat sampai)", () => {
    const reads: SlotRead[] = [{ day: 1, prayer: "isya", pages: 4 }];
    const v = computeKhatam(state({ reads }), new Date("2026-11-18T05:00:00Z"));
    expect(v.pagesRead).toBe(4);
    expect(v.today.every((s) => !s.done)).toBe(true);
  });

  it("setelah hari ke-30 tanpa selesai: status ended, ringkasan tetap bisa dihitung, tanpa slot", () => {
    const v = computeKhatam(state({ adjustment: 300 }), new Date("2026-12-17T05:00:00Z"));
    expect(v).toMatchObject({ status: "ended", day: 30, daysLeft: 0, pagesRead: 300, pagesLeft: 304, completedKhatam: 0, carriedOver: 0 });
    expect(v.today).toEqual([]);
  });

  it("selesai lebih awal tetap completed walau periode sudah lewat", () => {
    expect(computeKhatam(state({ adjustment: 604 }), new Date("2027-02-01T05:00:00Z")).status).toBe("completed");
  });

  it("hari terakhir (30) memakai 24N halaman dibagi lima", () => {
    const v = computeKhatam(state(), new Date("2026-12-16T05:00:00Z"));
    expect(v.day).toBe(30);
    expect(v.today.map((s) => s.pages)).toEqual([5, 5, 5, 5, 4]);
    expect(v.daysLeft).toBe(1);
  });
});

describe("KHATAM ganti target", () => {
  it("ganti N di tengah periode: halaman terbaca tetap, total dan rencana mengikuti N baru", () => {
    const reads: SlotRead[] = [{ day: 1, prayer: "subuh", pages: 4 }];
    const before = computeKhatam(state({ khatamCount: 1, reads, adjustment: 6 }), new Date("2026-11-18T05:00:00Z"));
    const after = computeKhatam(state({ khatamCount: 3, reads, adjustment: 6 }), new Date("2026-11-18T05:00:00Z"));
    expect(before.pagesRead).toBe(10);
    expect(after.pagesRead).toBe(10);
    expect(after.totalPages).toBe(1812);
    expect(after.today[0]!.pages).toBe(12);
    // The slot ticked under N=1 keeps its 4 pages.
    expect(reads[0]!.pages).toBe(4);
  });

  it("turun ke N lebih kecil dengan progres di atas total: dipotong ke total, status selesai", () => {
    const v = computeKhatam(state({ khatamCount: 1, adjustment: 1000 }), new Date("2026-11-18T05:00:00Z"));
    expect(v).toMatchObject({ pagesRead: 604, status: "completed" });
  });
});

describe("KHATAM tandai terakhir dibaca sampai halaman X", () => {
  it("maju dalam khatam yang sedang dibaca", () => {
    expect(positionAfterMark(0, 50, 1)).toBe(50);
    expect(positionAfterMark(50, 120, 3)).toBe(120);
  });

  it("mundur untuk koreksi", () => {
    expect(positionAfterMark(100, 90, 1)).toBe(90);
  });

  it("menandai halaman yang sama dua kali tidak mengubah apa pun, termasuk 604", () => {
    expect(positionAfterMark(604, 604, 2)).toBe(604);
    expect(positionAfterMark(77, 77, 5)).toBe(77);
  });

  it("selesai membaca 604 lalu lanjut di awal khatam berikutnya", () => {
    expect(positionAfterMark(604, 5, 2)).toBe(609);
    expect(positionAfterMark(600, 3, 2)).toBe(607);
  });

  it("halaman 604 dari posisi awal = 604, bukan 0 (kandidat khatam sebelum yang pertama tidak ada)", () => {
    expect(positionAfterMark(0, 604, 1)).toBe(604);
    expect(positionAfterMark(10, 604, 3)).toBe(604);
    expect(positionAfterMark(0, 1, 1)).toBe(1);
  });

  it("dibatasi 0..total (N=1 tidak bisa melewati 604)", () => {
    expect(positionAfterMark(600, 3, 1)).toBe(3);
    expect(positionAfterMark(604, 5, 1)).toBe(5);
  });

  it("seri jarak memilih arah maju", () => {
    // current 302 in khatam 1 of 2: page 604 is 302 ahead, page... candidates for page 604: 604 (dist 302) and 0? no, 0 is not a page.
    expect(positionAfterMark(302, 604, 2)).toBe(604);
    // current 906 = 302 into khatam 2; page 604 -> 604 (302 back) vs 1208 (302 ahead): forward wins.
    expect(positionAfterMark(906, 604, 3)).toBe(1208);
  });

  it("menolak halaman di luar 1..604", () => {
    expect(() => positionAfterMark(0, 0, 1)).toThrow(RangeError);
    expect(() => positionAfterMark(0, 605, 1)).toThrow(RangeError);
    expect(() => positionAfterMark(0, 1.5, 1)).toThrow(RangeError);
  });

  it("adjustmentFor membuat pagesRead tepat di posisi baru walau ada slot tercentang", () => {
    const reads: SlotRead[] = [
      { day: 1, prayer: "subuh", pages: 4 },
      { day: 1, prayer: "dzuhur", pages: 4 },
    ];
    const target = positionAfterMark(8, 50, 1);
    const s = state({ reads, adjustment: adjustmentFor(target, reads) });
    expect(pagesRead(s)).toBe(50);
    expect(computeKhatam(s, new Date("2026-11-17T05:00:00Z")).currentPage).toBe(51);
  });
});

import { applyPending } from "@/domain/khatam";

describe("KHATAM perubahan yang menunggu sinkronisasi", () => {
  it("centang dan tandai posisi diterapkan berurutan seperti di server", () => {
    const s = applyPending(state(), [
      { kind: "slot", day: 1, prayer: "subuh", done: true },
      { kind: "slot", day: 1, prayer: "dzuhur", done: true },
      { kind: "mark", page: 30 },
    ]);
    expect(pagesRead(s)).toBe(30);
    expect(s.reads.map((r) => r.prayer)).toEqual(["subuh", "dzuhur"]);
  });

  it("centang ganda dan lepas centang yang tidak ada tidak mengubah apa pun; input aneh diabaikan", () => {
    const s = applyPending(state(), [
      { kind: "slot", day: 1, prayer: "subuh", done: true },
      { kind: "slot", day: 1, prayer: "subuh", done: true },
      { kind: "slot", day: 1, prayer: "isya", done: false },
      { kind: "slot", day: 99, prayer: "isya", done: true },
      { kind: "mark", page: 0 },
    ]);
    expect(s.reads).toHaveLength(1);
    expect(s.adjustment).toBe(0);
  });

  it("tidak mengubah state asli", () => {
    const base = state();
    applyPending(base, [{ kind: "slot", day: 1, prayer: "subuh", done: true }]);
    expect(base.reads).toEqual([]);
  });
});
