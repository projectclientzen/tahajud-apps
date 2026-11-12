import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createMockDataLayer } from "@/data/mock";
import { idbStorage } from "@/data/mock/storage";
import { wib } from "../domain/helpers";

const clock = { now: () => wib("2026-11-12 08:00") };
const mk = (userId: string) => createMockDataLayer({ userId, clock, scenario: "new_account" });

describe("mock persistence in IndexedDB (database per user)", () => {
  it("uses IndexedDB `tahajud-<userId>` by default when available and survives a new instance", async () => {
    const a = mk("user-a");
    const s = await a.session.ensureActiveSession();
    const c = s.activities.find((x) => x.id.endsWith("~night:istighfar"))!;
    await a.session.applyCounterOperations(c.id, {
      operations: [
        { kind: "delta", operation_id: "persist-1", delta: 33, client_recorded_at: clock.now().toISOString() },
      ],
    });
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).toContain("tahajud-user-a");

    const again = mk("user-a"); // simulates app reopened
    const s2 = await again.session.getActiveSession();
    expect(s2!.id).toBe(s.id);
    expect(s2!.activities.find((x) => x.id.endsWith("~night:istighfar"))!.count).toBe(33);
    const dup = await again.session.applyCounterOperations(c.id, {
      operations: [
        { kind: "delta", operation_id: "persist-1", delta: 33, client_recorded_at: clock.now().toISOString() },
      ],
    });
    expect(dup.results[0]!.status).toBe("duplicate");
  });

  it("keeps users apart and wipes only the user's own database on reset (logout)", async () => {
    const a = mk("user-iso-a");
    const b = mk("user-iso-b");
    await a.session.ensureActiveSession();
    expect(await b.session.getActiveSession()).toBeNull();
    await a.dev.reset();
    expect(await idbStorage("user-iso-a").load()).toBeNull();
    expect(await a.session.getActiveSession()).toBeNull();
  });
});
