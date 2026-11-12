import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/data/contracts";
import { createMockDataLayer, type MockDataLayer } from "@/data";
import { memoryStorage } from "@/data/mock/storage";
import { displayCount, flush, initCounter, tap, applyAcks } from "@/domain/dhikr/counter";
import { OfflineQueue } from "@/offline/queue";
import { createLayerSender } from "@/offline/sender";
import type { QueueItem, QueueSender } from "@/offline/types";
import { wib } from "../domain/helpers";

let k = 0;
const NOW = wib("2026-11-12 02:00");

function world(scenario: "new_account" | "offline" = "new_account") {
  const userId = `flow-${++k}`;
  const layer: MockDataLayer = createMockDataLayer({
    userId,
    scenario,
    storage: memoryStorage(),
    clock: { now: () => NOW },
  });
  return { userId, layer };
}

async function istighfar(layer: MockDataLayer) {
  const s = await layer.session.ensureActiveSession();
  return { session: s, act: s.activities.find((a) => a.id.endsWith("~night:istighfar"))! };
}

const countOf = async (layer: MockDataLayer, id: string) =>
  (await layer.session.getActiveSession())!.activities.find((a) => a.id === id)!.count;

/** The tap path the UI will use: reducer makes operations, the queue carries them. */
function tapsToOps(activityId: string, taps: number, opId: string) {
  let s = initCounter(activityId, 100);
  for (let i = 0; i < taps; i++) s = tap(s, i);
  const r = flush(s, opId, 5000);
  return r.operation!;
}

const enqueueDelta = (q: OfflineQueue, entity: string, taps: number, opId: string) => {
  const o = tapsToOps(entity, taps, opId);
  if (o.kind !== "delta") throw new Error("expected delta");
  return q.enqueue({
    operation_id: o.operationId,
    entity_id: entity,
    operation_type: "counter_delta",
    payload: { delta: o.delta, client_recorded_at: o.clientRecordedAt },
  });
};

describe("DZIKIR-02 offline taps sync once after going online", () => {
  it("keeps notes while the server is unreachable, then sends them without double counting", async () => {
    const w = world("offline");
    const { act } = await istighfar(w.layer);
    const q = new OfflineQueue({ userId: w.userId, sender: createLayerSender(w.layer), flushOnEnqueue: false });
    await enqueueDelta(q, act.id, 7, "dz2-a");
    await enqueueDelta(q, act.id, 5, "dz2-b");

    expect(await q.flushNow()).toMatchObject({ status: "done", retry: 2, synced: 0 }); // mock says OFFLINE
    expect(await q.pendingCount()).toBe(2);
    expect(await countOf(w.layer, act.id)).toBe(0);

    await w.layer.dev.setOffline(false);
    expect(await q.flushNow()).toMatchObject({ synced: 2, retry: 0 });
    expect(await q.pendingCount()).toBe(0);
    expect(await countOf(w.layer, act.id)).toBe(12);
  });

  it("a lost response makes the client resend, and the server counts it once", async () => {
    const w = world();
    const { act } = await istighfar(w.layer);
    const real = createLayerSender(w.layer);
    let lose = true;
    const flaky: QueueSender = {
      async send(items: QueueItem[]) {
        const out = await real.send(items); // the server applied it
        if (lose) throw new Error("connection reset"); // but the answer never arrived
        return out;
      },
    };
    const q = new OfflineQueue({ userId: w.userId, sender: flaky, flushOnEnqueue: false });
    await enqueueDelta(q, act.id, 7, "lost-1");
    await enqueueDelta(q, act.id, 5, "lost-2");

    expect(await q.flushNow()).toMatchObject({ retry: 2 });
    expect(await countOf(w.layer, act.id)).toBe(12);
    lose = false;
    expect(await q.flushNow()).toMatchObject({ synced: 2 }); // the server answers "duplicate", counts nothing new
    expect(await countOf(w.layer, act.id)).toBe(12);
    expect(await q.pendingCount()).toBe(0);
  });

  it("reducer acks and queue agree: the screen count equals the server count after sync", async () => {
    const w = world();
    const { act } = await istighfar(w.layer);
    let s = initCounter(act.id, 100);
    for (let i = 0; i < 30; i++) s = tap(s, i);
    const r = flush(s, "ack-1", 100);
    const res = await w.layer.session.applyCounterOperations(act.id, {
      operations: [{ kind: "delta", operation_id: "ack-1", delta: 30, client_recorded_at: NOW.toISOString() }],
    });
    s = applyAcks(
      r.state,
      res.results.map((x) => ({
        operationId: x.operation_id,
        status: x.status,
        authoritativeCount: x.authoritative_count,
      })),
    );
    expect(displayCount(s)).toBe(await countOf(w.layer, act.id));
  });
});

describe("sender outcomes", () => {
  it("maps a session locked by the 48 hour window to rejected, and keeps the reason", async () => {
    const w = world();
    const { act } = await istighfar(w.layer);
    await w.layer.dev.setNow(wib("2026-11-15 12:01").toISOString());
    const q = new OfflineQueue({ userId: w.userId, sender: createLayerSender(w.layer), flushOnEnqueue: false });
    await enqueueDelta(q, act.id, 3, "locked-1");
    expect(await q.flushNow()).toMatchObject({ rejected: 1, synced: 0 });
    const [it] = await q.listRejected();
    expect(it).toMatchObject({ operation_id: "locked-1", last_error: "SESSION_LOCKED" });
    expect(await q.canLogoutSafely()).toBe(false);
  });

  it("applies a checklist tick, and reapplies it on a version conflict only when it still changes something", async () => {
    const w = world();
    const { act } = await istighfar(w.layer);
    const s = await w.layer.session.ensureActiveSession();
    const doa = s.activities.find((a) => a.id.endsWith("~night:doa"))!;
    const q = new OfflineQueue({ userId: w.userId, sender: createLayerSender(w.layer), flushOnEnqueue: false });
    void act;

    // another device ticked it first (version 1, checked)
    await w.layer.session.setChecklist(doa.id, { checked: true, version: 0 });
    // this device ticked it too, from version 0: server already has the same value
    await q.enqueue({
      operation_id: "c1",
      entity_id: doa.id,
      operation_type: "checklist_set",
      payload: { checked: true, version: 0 },
    });
    expect(await q.flushNow()).toMatchObject({ synced: 1 });

    // this device unticks from a stale version: server differs, so the action is applied again on top of the server version
    await q.enqueue({
      operation_id: "c2",
      entity_id: doa.id,
      operation_type: "checklist_set",
      payload: { checked: false, version: 0 },
    });
    expect(await q.flushNow()).toMatchObject({ synced: 1 });
    expect((await w.layer.session.getActiveSession())!.activities.find((a) => a.id === doa.id)).toMatchObject({
      checked: false,
      version: 2,
    });
  });

  it("retries when the server stays in conflict or sends no server value", async () => {
    const conflict = (details?: unknown) =>
      ({
        session: {
          setChecklist: async () => {
            throw new ApiError("VERSION_CONFLICT", "x", details);
          },
        },
      }) as never;
    const item = {
      operation_type: "checklist_set",
      payload: { checked: true, version: 0 },
      entity_id: "e",
    } as unknown as QueueItem;
    const twice = await createLayerSender(conflict({ server: { checked: false, version: 1 } })).send([item]);
    expect(twice).toEqual([{ kind: "retry", error: "VERSION_CONFLICT" }]);
    const none = await createLayerSender(conflict()).send([item]);
    expect(none).toEqual([{ kind: "retry", error: "VERSION_CONFLICT" }]);
  });

  it("retries an unexpected server error or origin refusal instead of dropping the note", async () => {
    for (const code of ["INTERNAL_ERROR", "FORBIDDEN_ORIGIN"] as const) {
      const layer = {
        session: {
          setChecklist: async () => {
            throw new ApiError(code, "x");
          },
        },
      } as never;
      const item = {
        operation_type: "checklist_set",
        payload: { checked: true, version: 0 },
        entity_id: "e",
      } as unknown as QueueItem;
      expect(await createLayerSender(layer).send([item])).toEqual([{ kind: "retry", error: code }]);
    }
  });

  it("classifies errors: transient ones retry, refusals are kept, unknown errors retry", async () => {
    const throwing = (e: unknown) =>
      ({
        session: {
          setChecklist: async () => {
            throw e;
          },
          applyCounterOperations: async () => {
            throw e;
          },
        },
      }) as never;
    const check = {
      operation_type: "checklist_set",
      payload: { checked: true, version: 0 },
      entity_id: "e",
    } as unknown as QueueItem;
    const delta = {
      operation_id: "o",
      operation_type: "counter_delta",
      payload: { delta: 1, client_recorded_at: "x" },
      entity_id: "e",
    } as unknown as QueueItem;
    for (const code of [
      "OFFLINE",
      "NOT_AVAILABLE",
      "RATE_LIMITED",
      "UNAUTHENTICATED",
      "ENTITLEMENT_INACTIVE",
    ] as const) {
      const [a] = await createLayerSender(throwing(new ApiError(code, "m"))).send([check]);
      expect(a).toEqual({ kind: "retry", error: code });
    }
    expect(await createLayerSender(throwing(new ApiError("NOT_FOUND", "m"))).send([check, delta])).toEqual([
      { kind: "rejected", code: "NOT_FOUND" },
      { kind: "rejected", code: "NOT_FOUND" },
    ]);
    expect(await createLayerSender(throwing(new Error("fetch failed"))).send([delta])).toEqual([
      { kind: "retry", error: "fetch failed" },
    ]);
    expect(await createLayerSender(throwing("weird")).send([delta])).toEqual([{ kind: "retry", error: "NETWORK" }]);
  });

  it("groups consecutive counter items per activity (max 50 per request) and keeps order across checklists", async () => {
    const calls: string[] = [];
    const layer = {
      session: {
        applyCounterOperations: async (id: string, req: { operations: { operation_id: string }[] }) => {
          calls.push(`${id}:${req.operations.length}`);
          return {
            results: req.operations.map((o) => ({
              operation_id: o.operation_id,
              status: "accepted",
              authoritative_count: 1,
              target: 1,
              completed: true,
              updated_at: "x",
            })),
          };
        },
        setChecklist: async (id: string) => {
          calls.push(`check:${id}`);
        },
      },
    } as never;
    const d = (id: string, entity: string, type = "counter_delta") =>
      ({
        operation_id: id,
        entity_id: entity,
        operation_type: type,
        payload: type === "checklist_set" ? { checked: true, version: 0 } : { delta: 1, client_recorded_at: "x" },
      }) as unknown as QueueItem;
    const items = [
      d("1", "A"),
      d("2", "A"),
      d("3", "A", "counter_set_zero"),
      d("4", "B", "checklist_set"),
      d("5", "A"),
      d("6", "B"),
    ];
    const out = await createLayerSender(layer).send(items);
    expect(out.every((o) => o.kind === "synced")).toBe(true);
    expect(calls).toEqual(["A:3", "check:B", "A:1", "B:1"]);

    calls.length = 0;
    const many = Array.from({ length: 60 }, (_, i) => d(`m${i}`, "A"));
    await createLayerSender(layer).send(many);
    expect(calls).toEqual(["A:50", "A:10"]);
  });

  it("retries an item the server did not answer, and keeps a rejected counter reason", async () => {
    const layer = {
      session: {
        applyCounterOperations: async () => ({
          results: [
            {
              operation_id: "b",
              status: "rejected",
              authoritative_count: 0,
              target: 1,
              completed: false,
              updated_at: "x",
              error_code: "INVALID_DELTA",
            },
            {
              operation_id: "c",
              status: "rejected",
              authoritative_count: 0,
              target: 1,
              completed: false,
              updated_at: "x",
            },
          ],
        }),
      },
    } as never;
    const d = (id: string) =>
      ({
        operation_id: id,
        entity_id: "A",
        operation_type: "counter_delta",
        payload: { delta: 1, client_recorded_at: "x" },
      }) as unknown as QueueItem;
    expect(await createLayerSender(layer).send([d("a"), d("b"), d("c")])).toEqual([
      { kind: "retry", error: "NO_RESULT" },
      { kind: "rejected", code: "INVALID_DELTA" },
      { kind: "rejected", code: "REJECTED" },
    ]);
  });
});
