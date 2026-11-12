import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { backoffMs } from "@/offline/backoff";
import { OfflineQueue, purgeUser } from "@/offline/queue";
import type { QueueItem, QueueSender, SendOutcome } from "@/offline/types";
import { STORE_QUEUE, STORE_STATE, openUserDb } from "@/data/user-db";
import { openDB } from "idb";

let n = 0;
const uid = () => `q-user-${++n}`;
let opn = 0;
const op = (entity = "2026-11-12~night:istighfar", delta = 1) => ({
  operation_id: `op-${++opn}`,
  entity_id: entity,
  operation_type: "counter_delta" as const,
  payload: { delta, client_recorded_at: "2026-11-12T01:00:00.000Z" },
});

function setup(sender: QueueSender, over: { online?: () => boolean } = {}) {
  const clock = { t: 1_000_000 };
  const userId = uid();
  const make = () =>
    new OfflineQueue({ userId, sender, now: () => clock.t, online: over.online, flushOnEnqueue: false });
  return { clock, userId, q: make(), reopen: make };
}

const always = (kind: SendOutcome["kind"], extra: object = {}): QueueSender => ({
  send: async (items) => items.map(() => ({ kind, ...extra }) as SendOutcome),
});

describe("offline queue: storing", () => {
  it("stores PRD §21.2 fields, in order, and survives a reopen", async () => {
    const s = setup(always("synced"));
    const a = await s.q.enqueue(op("e1", 3));
    const b = await s.q.enqueue({
      ...op("e2"),
      operation_type: "checklist_set",
      payload: { checked: true, version: 2 },
    });
    expect(a.seq).toBeLessThan(b.seq);
    expect(a).toMatchObject({
      user_id: s.userId,
      entity_id: "e1",
      operation_type: "counter_delta",
      sync_status: "pending",
      attempt_count: 0,
      next_attempt_at: null,
      last_error: null,
      client_timestamp: new Date(s.clock.t).toISOString(),
      payload: { delta: 3 },
    });
    expect(await s.q.pendingCount()).toBe(2);

    const again = s.reopen(); // app closed and opened again
    expect(await again.pendingCount()).toBe(2);
    expect(again.getSnapshot()).toMatchObject({ pending: 2, rejected: 0 });
  });

  it("enqueue is idempotent per operation_id", async () => {
    const s = setup(always("synced"));
    const o = op();
    const first = await s.q.enqueue(o);
    const second = await s.q.enqueue(o);
    expect(second.seq).toBe(first.seq);
    expect(await s.q.pendingCount()).toBe(1);
  });

  it("keeps a client timestamp when given", async () => {
    const s = setup(always("synced"));
    const it = await s.q.enqueue({ ...op(), client_timestamp: "2026-11-12T00:00:00.000Z" });
    expect(it.client_timestamp).toBe("2026-11-12T00:00:00.000Z");
  });

  it("flushes on enqueue by default", async () => {
    const sent: QueueItem[][] = [];
    const q = new OfflineQueue({
      userId: uid(),
      sender: { send: async (i) => (sent.push(i), i.map(() => ({ kind: "synced" }) as SendOutcome)) },
    });
    await q.enqueue(op());
    await new Promise((r) => setTimeout(r, 30));
    expect(sent).toHaveLength(1);
    expect(await q.pendingCount()).toBe(0);
  });
});

describe("offline queue: sending", () => {
  it("removes synced items, updates the snapshot, and tells subscribers", async () => {
    const s = setup(always("synced"));
    let calls = 0;
    const off = s.q.subscribe(() => calls++);
    await s.q.enqueue(op());
    await s.q.enqueue(op());
    const before = s.q.getSnapshot();
    s.clock.t += 5000;
    const r = await s.q.flushNow();
    expect(r).toEqual({ status: "done", synced: 2, rejected: 0, retry: 0 });
    expect(s.q.getSnapshot()).toMatchObject({ pending: 0, rejected: 0, lastSyncedAt: s.clock.t, flushing: false });
    expect(s.q.getSnapshot()).not.toBe(before);
    expect(s.q.getSnapshot()).toBe(s.q.getSnapshot()); // stable between changes
    expect(calls).toBeGreaterThan(2);
    off();
    const seen = calls;
    await s.q.enqueue(op());
    expect(calls).toBe(seen);
    expect((await (await openUserDb(s.userId)).getAll(STORE_QUEUE)).length).toBe(1);
  });

  it("does nothing while offline and keeps every note", async () => {
    let online = false;
    const sent: unknown[] = [];
    const s = setup(
      { send: async (i) => (sent.push(i), i.map(() => ({ kind: "synced" }) as SendOutcome)) },
      { online: () => online },
    );
    await s.q.enqueue(op());
    expect(await s.q.flushNow()).toEqual({ status: "offline" });
    expect(sent).toHaveLength(0);
    expect(await s.q.pendingCount()).toBe(1);
    online = true;
    expect(await s.q.flushNow()).toMatchObject({ status: "done", synced: 1 });
  });

  it("retries with exponential backoff and respects it in flushDue", async () => {
    let ok = false;
    const s = setup({
      send: async (i) => i.map(() => (ok ? { kind: "synced" } : { kind: "retry", error: "OFFLINE" }) as SendOutcome),
    });
    await s.q.enqueue(op());
    const t0 = s.clock.t;
    expect(await s.q.flushDue()).toMatchObject({ retry: 1 });
    expect(await s.q.nextAttemptAt()).toBe(t0 + backoffMs(1));
    const item = (await (await openUserDb(s.userId)).getAll(STORE_QUEUE))[0] as QueueItem;
    expect(item).toMatchObject({
      sync_status: "pending",
      attempt_count: 1,
      last_error: "OFFLINE",
      next_attempt_at: t0 + 2000,
    });

    expect(await s.q.flushDue()).toMatchObject({ synced: 0, retry: 0 }); // not due yet
    s.clock.t = t0 + 2000;
    expect(await s.q.flushDue()).toMatchObject({ retry: 1 });
    expect((await s.q.nextAttemptAt())! - s.clock.t).toBe(4000);

    ok = true;
    expect(await s.q.flushNow()).toMatchObject({ synced: 1 }); // manual flush ignores backoff
    expect(await s.q.nextAttemptAt()).toBeNull();
  });

  it("treats a thrown sender as a retry for every item", async () => {
    const s = setup({
      send: async () => {
        throw new Error("socket hang up");
      },
    });
    await s.q.enqueue(op());
    await s.q.enqueue(op());
    expect(await s.q.flushNow()).toMatchObject({ retry: 2 });
    const all = (await (await openUserDb(s.userId)).getAll(STORE_QUEUE)) as QueueItem[];
    expect(all.map((i) => i.last_error)).toEqual(["socket hang up", "socket hang up"]);
    const odd = setup({
      send: async () => {
        throw "boom";
      },
    });
    await odd.q.enqueue(op());
    expect(await odd.q.flushNow()).toMatchObject({ retry: 1 });
  });

  it("treats a missing outcome as a retry, never as success", async () => {
    const s = setup({ send: async () => [] });
    await s.q.enqueue(op());
    expect(await s.q.flushNow()).toMatchObject({ retry: 1, synced: 0 });
  });

  it("keeps rejected notes and shows them until dismissed (nothing is dropped silently)", async () => {
    const s = setup({
      send: async (items) =>
        items.map(
          (it, i) => (i === 0 ? { kind: "rejected", code: "SESSION_LOCKED" } : { kind: "synced" }) as SendOutcome,
        ),
    });
    const a = await s.q.enqueue(op("e1"));
    await s.q.enqueue(op("e2"));
    expect(await s.q.flushNow()).toMatchObject({ synced: 1, rejected: 1 });
    expect(s.q.getSnapshot()).toMatchObject({ pending: 0, rejected: 1 });
    const rej = await s.q.listRejected();
    expect(rej).toHaveLength(1);
    expect(rej[0]).toMatchObject({
      operation_id: a.operation_id,
      sync_status: "rejected",
      last_error: "SESSION_LOCKED",
    });
    expect(await s.q.flushNow()).toMatchObject({ synced: 0 }); // rejected is not resent

    const again = s.reopen();
    expect(await again.listRejected()).toHaveLength(1); // still there after restart
    await again.dismissRejected(["unknown-id"]);
    expect(await again.listRejected()).toHaveLength(1);
    await again.dismissRejected([a.operation_id]);
    expect(await again.listRejected()).toHaveLength(0);
    expect(again.getSnapshot().rejected).toBe(0);
  });

  it("puts 'syncing' items back to pending after a crash and resends them", async () => {
    const s = setup(always("synced"));
    const it = await s.q.enqueue(op());
    const db = await openUserDb(s.userId);
    await db.put(STORE_QUEUE, { ...it, sync_status: "syncing" }); // app died mid-send
    const reopened = s.reopen();
    expect(await reopened.pendingCount()).toBe(1);
    expect(await reopened.flushNow()).toMatchObject({ synced: 1 });
  });

  it("shares one flush between concurrent callers", async () => {
    let calls = 0;
    const s = setup({
      send: async (i) => {
        calls++;
        await new Promise((r) => setTimeout(r, 10));
        return i.map(() => ({ kind: "synced" }) as SendOutcome);
      },
    });
    await s.q.enqueue(op());
    const [a, b] = await Promise.all([s.q.flushNow(), s.q.flushDue()]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
    expect(s.q.getSnapshot().flushing).toBe(false);
  });

  it("sends in chunks of 50 and stops after a chunk that had a retry", async () => {
    const sizes: number[] = [];
    const s = setup({ send: async (i) => (sizes.push(i.length), i.map(() => ({ kind: "synced" }) as SendOutcome)) });
    for (let i = 0; i < 120; i++) await s.q.enqueue(op());
    expect(await s.q.flushNow()).toMatchObject({ synced: 120 });
    expect(sizes).toEqual([50, 50, 20]);

    const sizes2: number[] = [];
    const bad = setup({
      send: async (i) => (sizes2.push(i.length), i.map(() => ({ kind: "retry", error: "x" }) as SendOutcome)),
    });
    for (let i = 0; i < 60; i++) await bad.q.enqueue(op());
    await bad.q.flushNow();
    expect(sizes2).toEqual([50]);
  });

  it("uses real clock and navigator defaults", async () => {
    const q = new OfflineQueue({ userId: uid(), sender: always("synced"), flushOnEnqueue: false });
    const it = await q.enqueue(op());
    expect(Date.parse(it.client_timestamp)).toBeGreaterThan(0);
    expect(await q.flushNow()).toMatchObject({ synced: 1 }); // navigator is undefined in Node, counts as online
    expect(await q.nextAttemptAt()).toBeNull();
  });
});

describe("offline queue: logout safety and purge", () => {
  it("DZIKIR-06 canLogoutSafely is false while notes wait, true once synced", async () => {
    const s = setup(always("synced"));
    expect(await s.q.canLogoutSafely()).toBe(true);
    await s.q.enqueue(op());
    expect(await s.q.canLogoutSafely()).toBe(false);
    expect(await s.q.pendingCount()).toBe(1);
    await s.q.flushNow();
    expect(await s.q.canLogoutSafely()).toBe(true);
  });

  it("DZIKIR-06 refused notes also block a silent logout until the user has seen them", async () => {
    const s = setup(always("rejected", { code: "SESSION_LOCKED" }));
    await s.q.enqueue(op());
    await s.q.flushNow();
    expect(await s.q.canLogoutSafely()).toBe(false);
    await s.q.dismissRejected();
    expect(await s.q.canLogoutSafely()).toBe(true);
  });

  it("SECURITY-06 purgeUser deletes the user's database and leaves other users alone", async () => {
    const a = setup(always("synced"));
    const b = setup(always("synced"));
    await a.q.enqueue(op());
    await b.q.enqueue(op());
    const names = async () => (await indexedDB.databases()).map((d) => d.name);
    expect(await names()).toEqual(expect.arrayContaining([`tahajud-${a.userId}`, `tahajud-${b.userId}`]));

    await purgeUser(a.userId);
    const after = await names();
    expect(after).not.toContain(`tahajud-${a.userId}`);
    expect(after).toContain(`tahajud-${b.userId}`);
    expect(await b.reopen().pendingCount()).toBe(1);

    const fresh = a.reopen(); // same user logs in again: empty, no leftovers
    expect(await fresh.pendingCount()).toBe(0);
  });

  it("purging a user that has no database is fine", async () => {
    await expect(purgeUser("never-existed")).resolves.toBeUndefined();
  });
});

describe("offline queue: round 3 wiring", () => {
  it("lists pending notes for one entity, oldest first, without refused ones", async () => {
    const s = setup(always("rejected", { code: "SESSION_LOCKED" }));
    const a = await s.q.enqueue(op("e1", 1));
    await s.q.enqueue(op("e2", 2));
    const c = await s.q.enqueue(op("e1", 3));
    expect((await s.q.listPending("e1")).map((i) => i.seq)).toEqual([a.seq, c.seq]);
    expect(await s.q.listPending()).toHaveLength(3);
    await s.q.flushNow(); // everything is refused
    expect(await s.q.listPending()).toEqual([]);
    expect(await s.q.listRejected()).toHaveLength(3);
  });

  it("reports the last retry error, keeps it while nothing was tried, and clears it after a clean send", async () => {
    let fail = true;
    const s = setup({
      send: async (items) =>
        items.map(() => (fail ? { kind: "retry", error: "OFFLINE" } : { kind: "synced" })) as SendOutcome[],
    });
    await s.q.enqueue(op("e1"));
    expect(s.q.getSnapshot().lastError).toBeNull();
    await s.q.flushNow();
    expect(s.q.getSnapshot().lastError).toBe("OFFLINE");
    await s.q.flushDue(); // backoff has not passed: nothing is tried, so the reason is kept
    expect(s.q.getSnapshot().lastError).toBe("OFFLINE");
    fail = false;
    await s.q.flushNow();
    expect(s.q.getSnapshot()).toMatchObject({ pending: 0, lastError: null });
  });

  it("says OFFLINE when the browser is offline and notes are waiting", async () => {
    let online = false;
    const s = setup(always("synced"), { online: () => online });
    await s.q.enqueue(op("e1"));
    expect(await s.q.flushNow()).toEqual({ status: "offline" });
    expect(s.q.getSnapshot().lastError).toBe("OFFLINE");
    online = true;
    await s.q.flushNow();
    expect(s.q.getSnapshot().lastError).toBeNull();
  });

  it("SECURITY-06 close() stops everything: no write into a database that logout is about to delete", async () => {
    const s = setup(always("synced"));
    await s.q.enqueue(op("e1"));
    await s.q.close();
    const late = await s.q.enqueue(op("e1", 5)); // a counter screen unmounting after logout
    expect(late.seq).toBe(-1);
    expect(await s.q.flushNow()).toEqual({ status: "offline" });
    expect(await s.reopen().pendingCount()).toBe(1); // only the note from before close() is on disk
    await purgeUser(s.userId);
    expect(((await indexedDB.databases()) ?? []).map((d) => d.name)).not.toContain(`tahajud-${s.userId}`);
  });

  it("close() waits for a send that is already running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const s = setup({
      send: async (items) => {
        await gate;
        return items.map(() => ({ kind: "synced" }) as SendOutcome);
      },
    });
    await s.q.enqueue(op("e1"));
    const flushing = s.q.flushNow();
    let closed = false;
    const closing = s.q.close().then(() => (closed = true));
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await flushing;
    await closing;
    expect(closed).toBe(true);
    expect(await s.reopen().pendingCount()).toBe(0);
  });
});

describe("user database upgrade", () => {
  it("adds the queue store to a version 1 database and keeps the mock state", async () => {
    const userId = "upgrade-user";
    const v1 = await openDB(`tahajud-${userId}`, 1, { upgrade: (d) => void d.createObjectStore("state") });
    await v1.put("state", { scenario: "kept" }, "mock");
    v1.close();
    const db = await openUserDb(userId);
    expect([...db.objectStoreNames].sort()).toEqual([STORE_QUEUE, STORE_STATE].sort());
    expect(await db.get(STORE_STATE, "mock")).toEqual({ scenario: "kept" });
    await purgeUser(userId);
  });
});
