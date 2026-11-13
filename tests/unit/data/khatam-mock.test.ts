import { describe, expect, it } from "vitest";
import { ApiError } from "@/data/contracts";
import { createMockDataLayer, type MockDataLayer } from "@/data/mock";
import { memoryStorage } from "@/data/mock/storage";
import { computeKhatam } from "@/domain/khatam";
import { wib } from "../domain/helpers";

let k = 0;
function make(at = "2026-11-17 12:00", scenario: "new_account" | "offline" = "new_account") {
  let now = wib(at);
  const layer: MockDataLayer = createMockDataLayer({
    userId: `khatam-${++k}`,
    scenario,
    storage: memoryStorage(),
    clock: { now: () => now },
  });
  return { layer, setNow: (s: string) => (now = wib(s)) };
}
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "no-error";
  } catch (e) {
    return e instanceof ApiError ? e.code : `other:${String(e)}`;
  }
};
const view = (s: Awaited<ReturnType<MockDataLayer["khatam"]["getKhatam"]>>) =>
  computeKhatam(
    { khatamCount: s.target!.khatam_count, startDate: s.target!.start_date, timezone: s.target!.timezone, adjustment: s.target!.adjustment, reads: s.reads },
    new Date(s.server_now),
  );

describe("KHATAM repository mock", () => {
  it("kosong dulu, lalu target dibuat mulai hari ini dengan zona user", async () => {
    const { layer } = make();
    expect((await layer.khatam.getKhatam()).target).toBeNull();
    const s = await layer.khatam.createTarget({ khatam_count: 2 });
    expect(s.target).toMatchObject({ khatam_count: 2, start_date: "2026-11-17", end_date: "2026-12-16", adjustment: 0 });
    expect(await code(layer.khatam.createTarget({ khatam_count: 3 }))).toBe("VALIDATION_ERROR");
  });

  it("centang, lepas centang, idempotent, hari depan ditolak", async () => {
    const { layer } = make();
    await layer.khatam.createTarget({ khatam_count: 1 });
    await layer.khatam.setSlot({ day: 1, prayer: "subuh", done: true });
    const s = await layer.khatam.setSlot({ day: 1, prayer: "subuh", done: true });
    expect(s.reads).toEqual([{ day: 1, prayer: "subuh", pages: 4 }]);
    expect(await code(layer.khatam.setSlot({ day: 2, prayer: "subuh", done: true }))).toBe("VALIDATION_ERROR");
    expect((await layer.khatam.setSlot({ day: 1, prayer: "subuh", done: false })).reads).toEqual([]);
    expect((await layer.khatam.setSlot({ day: 1, prayer: "subuh", done: false })).reads).toEqual([]);
  });

  it("tandai posisi dan ganti N tanpa mengubah halaman yang sudah terbaca", async () => {
    const { layer } = make();
    await layer.khatam.createTarget({ khatam_count: 1 });
    await layer.khatam.setSlot({ day: 1, prayer: "subuh", done: true });
    const m = await layer.khatam.markPosition({ page: 50 });
    expect(view(m).pagesRead).toBe(50);
    const c = await layer.khatam.changeTarget({ khatam_count: 5 });
    expect(view(c)).toMatchObject({ pagesRead: 50, totalPages: 3020 });
    expect(await code(layer.khatam.changeTarget({ khatam_count: 6 as never }))).toBe("VALIDATION_ERROR");
  });

  it("tanpa target: centang dan tandai posisi = NOT_FOUND", async () => {
    const { layer } = make();
    expect(await code(layer.khatam.setSlot({ day: 1, prayer: "subuh", done: true }))).toBe("NOT_FOUND");
    expect(await code(layer.khatam.markPosition({ page: 3 }))).toBe("NOT_FOUND");
    expect(await code(layer.khatam.changeTarget({ khatam_count: 2 }))).toBe("NOT_FOUND");
  });

  it("setelah 30 hari target baru boleh dibuat dan yang lama diganti; ganti N ditolak", async () => {
    const { layer, setNow } = make();
    await layer.khatam.createTarget({ khatam_count: 1 });
    setNow("2026-12-17 12:00");
    expect(await code(layer.khatam.changeTarget({ khatam_count: 2 }))).toBe("VALIDATION_ERROR");
    const n = await layer.khatam.createTarget({ khatam_count: 4 });
    expect(n.target).toMatchObject({ khatam_count: 4, start_date: "2026-12-17" });
    expect(n.reads).toEqual([]);
  });

  it("offline: tulis ditolak OFFLINE (antrean yang akan mencoba lagi), baca tetap jalan", async () => {
    const { layer } = make("2026-11-17 12:00", "offline");
    expect(await code(layer.khatam.createTarget({ khatam_count: 1 }))).toBe("OFFLINE");
    expect(await code(layer.khatam.getKhatam())).toBe("no-error");
  });

  it("data khatam tidak bocor antar user", async () => {
    const a = make();
    const b = make();
    await a.layer.khatam.createTarget({ khatam_count: 3 });
    expect((await b.layer.khatam.getKhatam()).target).toBeNull();
  });
});
