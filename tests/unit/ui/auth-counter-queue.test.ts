import { describe, expect, it } from "vitest";
import { opsFromQueue } from "@/components/dhikr/counter-screen";
import { displayCount, initCounter } from "@/domain/dhikr/counter";
import type { QueueItem } from "@/offline";

const item = (over: Partial<QueueItem>): QueueItem => ({
  seq: 1,
  operation_id: "op-1",
  user_id: "u_1",
  entity_id: "act-A",
  operation_type: "counter_delta",
  payload: { delta: 5, client_recorded_at: "2026-11-13T01:00:00.000Z" },
  client_timestamp: "2026-11-13T01:00:00.000Z",
  sync_status: "pending",
  attempt_count: 0,
  next_attempt_at: null,
  last_error: null,
  ...over,
});

describe("opsFromQueue (rebuilding the counter after a reload)", () => {
  it("keeps only this activity, in order, and skips refused and checklist items", () => {
    const ops = opsFromQueue(
      [
        item({ seq: 3, operation_id: "c", payload: { delta: 2, client_recorded_at: "t" } }),
        item({ seq: 1, operation_id: "a", payload: { delta: 5, client_recorded_at: "t" } }),
        item({ seq: 2, operation_id: "other", entity_id: "act-B" }),
        item({ seq: 4, operation_id: "refused", sync_status: "rejected" }),
        item({ seq: 5, operation_id: "tick", operation_type: "checklist_set", payload: { checked: true, version: 0 } }),
      ],
      "act-A",
    );
    expect(ops.map((o) => o.operationId)).toEqual(["a", "c"]);
  });

  it("DZIKIR-02: queued taps show on top of the server count, and a reset zeroes what came before", () => {
    const state = (n: number, items: QueueItem[]) => ({
      ...initCounter("act-A", 100, n),
      inflight: opsFromQueue(items, "act-A"),
    });
    expect(displayCount(state(20, [item({ payload: { delta: 10, client_recorded_at: "t" } })]))).toBe(30);
    const withReset = [
      item({ seq: 1, operation_id: "d", payload: { delta: 10, client_recorded_at: "t" } }),
      item({ seq: 2, operation_id: "z", operation_type: "counter_set_zero", payload: { client_recorded_at: "t" } }),
      item({ seq: 3, operation_id: "e", payload: { delta: 3, client_recorded_at: "t" } }),
    ];
    expect(displayCount(state(20, withReset))).toBe(3);
  });

  it("never shows a negative count", () => {
    const s = {
      ...initCounter("act-A", 100, 2),
      inflight: opsFromQueue([item({ payload: { delta: -9, client_recorded_at: "t" } })], "act-A"),
    };
    expect(displayCount(s)).toBe(0);
  });
});
