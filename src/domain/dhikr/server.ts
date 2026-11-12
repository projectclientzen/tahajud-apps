import { MAX_DELTA, type CounterOperation } from "./counter";

/** In-memory model of the server counter tables. The SQL version (S5) must behave the same. */
export interface CounterStore {
  /** `${userId}:${activityId}` -> authoritative count, never negative. */
  counts: Record<string, number>;
  /** `${userId}:${operationId}` -> applied record. Mirrors UNIQUE (user_id, client_operation_id). */
  applied: Record<string, AppliedOperation>;
}

export interface AppliedOperation {
  operationId: string;
  activityId: string;
  kind: CounterOperation["kind"];
  delta: number;
  /** Client time after clamping (PRD §12.3, BUG-09). */
  recordedAt: string;
  serverAppliedAt: string;
}

export type OperationErrorCode = "SESSION_LOCKED" | "INVALID_DELTA" | "ACTIVITY_NOT_FOUND";

export interface OperationResult {
  operationId: string;
  status: "accepted" | "duplicate" | "rejected";
  authoritativeCount: number;
  target: number;
  completed: boolean;
  updatedAt: string;
  errorCode?: OperationErrorCode;
}

export interface ServerContext {
  userId: string;
  /** Server time. */
  now: Date;
  /** Looks up the activity for this user: its target and whether the session is inside the correction window. */
  activity: (activityId: string) => { target: number; windowOpen: boolean } | null;
}

export const MAX_BATCH = 50;
export const MAX_FUTURE_SKEW_MS = 5 * 60_000;

export const emptyCounterStore = (): CounterStore => ({ counts: {}, applied: {} });

/** `client_recorded_at` more than 5 minutes ahead of the server is clamped to server time. */
export function clampRecordedAt(clientRecordedAt: string, now: Date): string {
  const t = Date.parse(clientRecordedAt);
  if (Number.isNaN(t) || t > now.getTime() + MAX_FUTURE_SKEW_MS) return now.toISOString();
  return new Date(t).toISOString();
}

/**
 * Apply one operation once per (user, operation id). Duplicates change nothing and report the
 * current authoritative count. Counts never go below zero. `set_zero` makes the count 0 and keeps the
 * history, later deltas still apply (PRD §12.3, §12.4).
 */
export function applyOperation(
  store: CounterStore,
  op: CounterOperation,
  ctx: ServerContext,
): { store: CounterStore; result: OperationResult } {
  const countKey = `${ctx.userId}:${op.activityId}`;
  const opKey = `${ctx.userId}:${op.operationId}`;
  const updatedAt = ctx.now.toISOString();
  const act = ctx.activity(op.activityId);
  const count = store.counts[countKey] ?? 0;
  const base = { operationId: op.operationId, updatedAt, authoritativeCount: count, target: act?.target ?? 0 };

  const prior = store.applied[opKey];
  if (prior) {
    return { store, result: { ...base, status: "duplicate", completed: !!act && count >= act.target } };
  }
  const reject = (errorCode: OperationErrorCode) => ({
    store,
    result: { ...base, status: "rejected" as const, completed: !!act && count >= act.target, errorCode },
  });
  if (!act) return reject("ACTIVITY_NOT_FOUND");
  if (!act.windowOpen) return reject("SESSION_LOCKED");
  if (op.kind === "delta" && (!Number.isInteger(op.delta) || Math.abs(op.delta) > MAX_DELTA || op.delta === 0)) {
    return reject("INVALID_DELTA");
  }

  const next = op.kind === "set_zero" ? 0 : Math.max(0, count + op.delta);
  const applied: AppliedOperation = {
    operationId: op.operationId,
    activityId: op.activityId,
    kind: op.kind,
    delta: op.kind === "delta" ? op.delta : 0,
    recordedAt: clampRecordedAt(op.clientRecordedAt, ctx.now),
    serverAppliedAt: updatedAt,
  };
  return {
    store: {
      counts: { ...store.counts, [countKey]: next },
      applied: { ...store.applied, [opKey]: applied },
    },
    result: {
      ...base,
      status: "accepted",
      authoritativeCount: next,
      completed: next >= act.target,
    },
  };
}

/** Batch endpoint: at most 50 operations per request, applied in order (PRD §19.4). */
export function applyBatch(
  store: CounterStore,
  ops: readonly CounterOperation[],
  ctx: ServerContext,
): { store: CounterStore; results: OperationResult[] } {
  if (ops.length > MAX_BATCH) throw new RangeError(`At most ${MAX_BATCH} operations per request`);
  let s = store;
  const results: OperationResult[] = [];
  for (const op of ops) {
    const r = applyOperation(s, op, ctx);
    s = r.store;
    results.push(r.result);
  }
  return { store: s, results };
}
