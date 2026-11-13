import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createMockDataLayer, type MockDataLayer } from "@/data";
import { memoryStorage } from "@/data/mock/storage";
import { OfflineQueue } from "@/offline/queue";
import { createLayerSender } from "@/offline/sender";
import { wib } from "../domain/helpers";

let k = 0;
const NOW = wib("2026-11-17 12:00");
function world() {
  const userId = `khatam-sync-${++k}`;
  const layer: MockDataLayer = createMockDataLayer({ userId, scenario: "new_account", storage: memoryStorage(), clock: { now: () => NOW } });
  const queue = new OfflineQueue({ userId, sender: createLayerSender(layer), flushOnEnqueue: false });
  return { layer, queue };
}

describe("KHATAM antrean offline", () => {
  it("centang dan tandai posisi yang dibuat offline terkirim sekali, berurutan", async () => {
    const { layer, queue } = world();
    await layer.khatam.createTarget({ khatam_count: 1 });
    await queue.enqueue({ operation_id: "s1", entity_id: "khatam:1:subuh", operation_type: "khatam_slot_set", payload: { day: 1, prayer: "subuh", done: true } });
    await queue.enqueue({ operation_id: "s2", entity_id: "khatam:1:dzuhur", operation_type: "khatam_slot_set", payload: { day: 1, prayer: "dzuhur", done: true } });
    await queue.enqueue({ operation_id: "m1", entity_id: "khatam:position", operation_type: "khatam_mark", payload: { page: 30 } });
    expect(await queue.pendingCount()).toBe(3);
    const r = await queue.flushNow();
    expect(r).toMatchObject({ status: "done", synced: 3, rejected: 0 });
    const s = await layer.khatam.getKhatam();
    expect(s.reads.map((x) => x.prayer)).toEqual(["subuh", "dzuhur"]);
    expect(s.target!.adjustment + 8).toBe(30);
  });

  it("mengirim ulang operasi yang sama tidak menggandakan apa pun", async () => {
    const { layer, queue } = world();
    await layer.khatam.createTarget({ khatam_count: 1 });
    for (const id of ["a", "b"]) {
      await queue.enqueue({ operation_id: id, entity_id: "khatam:1:subuh", operation_type: "khatam_slot_set", payload: { day: 1, prayer: "subuh", done: true } });
      await queue.enqueue({ operation_id: `${id}m`, entity_id: "khatam:position", operation_type: "khatam_mark", payload: { page: 12 } });
    }
    await queue.flushNow();
    const s = await layer.khatam.getKhatam();
    expect(s.reads).toHaveLength(1);
    expect(s.target!.adjustment + 4).toBe(12);
  });

  it("ditolak server untuk selamanya (hari depan) = rejected dan tetap terlihat, bukan hilang diam-diam", async () => {
    const { layer, queue } = world();
    await layer.khatam.createTarget({ khatam_count: 1 });
    await queue.enqueue({ operation_id: "f", entity_id: "khatam:9:subuh", operation_type: "khatam_slot_set", payload: { day: 9, prayer: "subuh", done: true } });
    const r = await queue.flushNow();
    expect(r).toMatchObject({ status: "done", synced: 0, rejected: 1 });
    expect(await queue.listRejected()).toHaveLength(1);
  });

  it("sender tanpa repository khatam menunggu (retry), tidak menjatuhkan catatan", async () => {
    const userId = `khatam-sync-${++k}`;
    const layer = createMockDataLayer({ userId, scenario: "new_account", storage: memoryStorage(), clock: { now: () => NOW } });
    const queue = new OfflineQueue({ userId, sender: createLayerSender({ session: layer.session }), flushOnEnqueue: false });
    await queue.enqueue({ operation_id: "x", entity_id: "khatam:position", operation_type: "khatam_mark", payload: { page: 5 } });
    const r = await queue.flushNow();
    expect(r).toMatchObject({ status: "done", synced: 0, retry: 1 });
  });
});
