import { STORE_QUEUE, openUserDb, purgeUserDb } from "@/data/user-db";
import { backoffMs } from "./backoff";
import type { FlushResult, NewQueueItem, QueueItem, QueueSender, QueueSnapshot } from "./types";

export interface QueueOptions {
  userId: string;
  sender: QueueSender;
  /** Epoch ms. Injected for tests. */
  now?: () => number;
  /** Defaults to `navigator.onLine`. */
  online?: () => boolean;
  /** Try to send right after `enqueue`. */
  flushOnEnqueue?: boolean;
}

const CHUNK = 50;

/**
 * Offline mutation queue for one user. Every tap batch and checklist tick goes in first, then out.
 * Nothing leaves silently: synced items are removed, rejected items stay until `dismissRejected`.
 * Safe to resend: the server dedupes by `operation_id`.
 */
export class OfflineQueue {
  private items = new Map<number, QueueItem>();
  private loaded: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private snap: QueueSnapshot = { pending: 0, rejected: 0, lastSyncedAt: null, flushing: false };
  private running: Promise<FlushResult> | null = null;
  private readonly now: () => number;
  private readonly online: () => boolean;

  constructor(private readonly o: QueueOptions) {
    this.now = o.now ?? (() => Date.now());
    this.online = o.online ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  }

  private ready(): Promise<void> {
    this.loaded ??= (async () => {
      const db = await openUserDb(this.o.userId);
      const all = (await db.getAll(STORE_QUEUE)) as QueueItem[];
      for (const it of all) {
        // A crash mid-send leaves "syncing". Resend is safe because the server dedupes.
        if (it.sync_status === "syncing") {
          it.sync_status = "pending";
          await db.put(STORE_QUEUE, it);
        }
        this.items.set(it.seq, it);
      }
      this.refresh();
    })();
    return this.loaded;
  }

  // ---------- reading ----------
  /** Latest snapshot. Same object until something changes, so it works with useSyncExternalStore. */
  getSnapshot = (): QueueSnapshot => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private refresh(patch: Partial<QueueSnapshot> = {}): void {
    let pending = 0;
    let rejected = 0;
    for (const it of this.items.values()) {
      if (it.sync_status === "rejected") rejected++;
      else pending++;
    }
    this.snap = { ...this.snap, ...patch, pending, rejected };
    for (const l of this.listeners) l();
  }

  async pendingCount(): Promise<number> {
    await this.ready();
    return this.snap.pending;
  }

  /** Notes still waiting or being sent, oldest first. Screens use it to show a change the server has not confirmed yet. */
  async listPending(entityId?: string): Promise<QueueItem[]> {
    await this.ready();
    return [...this.items.values()]
      .filter((i) => i.sync_status !== "rejected" && (entityId === undefined || i.entity_id === entityId))
      .sort((a, b) => a.seq - b.seq);
  }

  async listRejected(): Promise<QueueItem[]> {
    await this.ready();
    return [...this.items.values()].filter((i) => i.sync_status === "rejected");
  }

  /**
   * False while notes wait to sync, or while refused notes have not been shown to the user.
   * The logout dialog uses it (DZIKIR-06).
   */
  async canLogoutSafely(): Promise<boolean> {
    await this.ready();
    return this.snap.pending === 0 && this.snap.rejected === 0;
  }

  /** Earliest time a retry is due, or null when nothing waits. For timers. */
  async nextAttemptAt(): Promise<number | null> {
    await this.ready();
    let next: number | null = null;
    for (const it of this.items.values()) {
      if (it.sync_status !== "pending") continue;
      const t = it.next_attempt_at ?? 0;
      if (next === null || t < next) next = t;
    }
    return next;
  }

  // ---------- writing ----------
  /** Add a mutation. Same `operation_id` twice returns the first one. */
  async enqueue(input: NewQueueItem): Promise<QueueItem> {
    await this.ready();
    const dup = [...this.items.values()].find((i) => i.operation_id === input.operation_id);
    if (dup) return dup;
    const db = await openUserDb(this.o.userId);
    const item: Omit<QueueItem, "seq"> = {
      operation_id: input.operation_id,
      user_id: this.o.userId,
      entity_id: input.entity_id,
      operation_type: input.operation_type,
      payload: input.payload,
      client_timestamp: input.client_timestamp ?? new Date(this.now()).toISOString(),
      sync_status: "pending",
      attempt_count: 0,
      next_attempt_at: null,
      last_error: null,
    };
    const seq = (await db.add(STORE_QUEUE, item)) as number;
    const stored = { ...item, seq };
    this.items.set(seq, stored);
    this.refresh();
    if (this.o.flushOnEnqueue ?? true) void this.flushDue();
    return stored;
  }

  /** Remove refused notes after the UI has shown them. No ids means all. */
  async dismissRejected(operationIds?: string[]): Promise<void> {
    await this.ready();
    const db = await openUserDb(this.o.userId);
    for (const it of [...this.items.values()]) {
      if (it.sync_status !== "rejected") continue;
      if (operationIds && !operationIds.includes(it.operation_id)) continue;
      await db.delete(STORE_QUEUE, it.seq);
      this.items.delete(it.seq);
    }
    this.refresh();
  }

  // ---------- sending ----------
  /** Send everything now, ignoring backoff (user tapped "Sinkronkan"). */
  flushNow(): Promise<FlushResult> {
    return this.flush(true);
  }

  /** Send what is due (backoff respected). Called on online, app open, visible, and timers. */
  flushDue(): Promise<FlushResult> {
    return this.flush(false);
  }

  private flush(force: boolean): Promise<FlushResult> {
    this.running ??= this.run(force).finally(() => {
      this.running = null;
      this.refresh({ flushing: false });
    });
    return this.running;
  }

  private async run(force: boolean): Promise<FlushResult> {
    await this.ready();
    if (!this.online()) return { status: "offline" };
    this.refresh({ flushing: true });
    const db = await openUserDb(this.o.userId);
    const total = { synced: 0, rejected: 0, retry: 0 };
    for (;;) {
      const due = [...this.items.values()]
        .filter((i) => i.sync_status === "pending" && (force || (i.next_attempt_at ?? 0) <= this.now()))
        .sort((a, b) => a.seq - b.seq)
        .slice(0, CHUNK);
      if (due.length === 0) break;
      for (const it of due) {
        it.sync_status = "syncing";
        await db.put(STORE_QUEUE, it);
      }
      let outcomes;
      try {
        outcomes = await this.o.sender.send(due);
      } catch (e) {
        outcomes = due.map(() => ({ kind: "retry" as const, error: e instanceof Error ? e.message : String(e) }));
      }
      let hadRetry = false;
      for (const [i, it] of due.entries()) {
        const out = outcomes[i] ?? { kind: "retry" as const, error: "NO_OUTCOME" };
        if (out.kind === "synced") {
          await db.delete(STORE_QUEUE, it.seq);
          this.items.delete(it.seq);
          total.synced++;
        } else if (out.kind === "rejected") {
          it.sync_status = "rejected";
          it.last_error = out.code;
          await db.put(STORE_QUEUE, it);
          total.rejected++;
        } else {
          it.sync_status = "pending";
          it.attempt_count += 1;
          it.last_error = out.error;
          it.next_attempt_at = this.now() + backoffMs(it.attempt_count);
          await db.put(STORE_QUEUE, it);
          total.retry++;
          hadRetry = true;
        }
      }
      this.refresh(total.synced > 0 ? { lastSyncedAt: this.now() } : {});
      if (hadRetry) break; // do not hammer a server that just failed
      force = false; // later chunks respect backoff of items that were retried earlier
    }
    return { status: "done", ...total };
  }
}

/** Delete this user's whole local database: queue, mock state, everything (logout, SECURITY-06). */
export const purgeUser = (userId: string): Promise<void> => purgeUserDb(userId);
