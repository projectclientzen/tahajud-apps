/**
 * Local dhikr counter reducer (PRD §12). Pure: time and operation ids are passed in.
 * Display = last server count + operations in flight + taps not yet flushed.
 */
export const FLUSH_INTERVAL_MS = 2_000;
export const MAX_DELTA = 1_000;

export type CounterOperation =
  | { kind: "delta"; operationId: string; activityId: string; delta: number; clientRecordedAt: string }
  | { kind: "set_zero"; operationId: string; activityId: string; clientRecordedAt: string };

export interface CounterState {
  activityId: string;
  target: number;
  /** Authoritative count from the last ack or refresh. */
  serverCount: number;
  /** Operations sent, not yet acknowledged. */
  inflight: CounterOperation[];
  /** Taps buffered locally. */
  pendingDelta: number;
  /** When the first buffered tap happened (ms epoch), null when nothing is buffered. */
  bufferedSince: number | null;
  /** Operation ids the server refused (e.g. SESSION_LOCKED), kept so the UI can tell the user. */
  rejected: string[];
}

export function initCounter(activityId: string, target: number, serverCount = 0): CounterState {
  return { activityId, target, serverCount, inflight: [], pendingDelta: 0, bufferedSince: null, rejected: [] };
}

/** Effect of one in-flight operation on the displayed count, given the count before it. */
function applyOp(count: number, op: CounterOperation): number {
  return op.kind === "set_zero" ? 0 : Math.max(0, count + op.delta);
}

/** Count shown to the user. Never negative. */
export function displayCount(s: CounterState): number {
  let c = s.serverCount;
  for (const op of s.inflight) c = applyOp(c, op);
  return Math.max(0, c + s.pendingDelta);
}

export const isTargetReached = (s: CounterState): boolean => displayCount(s) >= s.target;
/** "+N lebih" past the target (PRD §12.2). */
export const extraCount = (s: CounterState): number => Math.max(0, displayCount(s) - s.target);

/** +1 or -1 tap at `now` (ms epoch). Minus at 0 does nothing. */
export function tap(s: CounterState, now: number, step: 1 | -1 = 1): CounterState {
  if (step === -1 && displayCount(s) <= 0) return s;
  return { ...s, pendingDelta: s.pendingDelta + step, bufferedSince: s.bufferedSince ?? now };
}

export interface FlushContext {
  now: number;
  /** Page is going to background (visibilitychange hidden) or navigating away. */
  leaving?: boolean;
}

/** Flush when 2 s passed, target just reached, the page is leaving, or the buffer hit the size cap. */
export function shouldFlush(s: CounterState, ctx: FlushContext): boolean {
  if (s.pendingDelta === 0) return false;
  if (ctx.leaving) return true;
  if (Math.abs(s.pendingDelta) >= MAX_DELTA) return true;
  if (s.bufferedSince !== null && ctx.now - s.bufferedSince >= FLUSH_INTERVAL_MS) return true;
  const before = Math.max(0, displayCount({ ...s, pendingDelta: 0 }));
  return before < s.target && displayCount(s) >= s.target;
}

export interface FlushResult {
  state: CounterState;
  operation: CounterOperation | null;
}

/** Turn the buffer into one delta operation. `operationId` is a client UUID v4. */
export function flush(s: CounterState, operationId: string, now: number): FlushResult {
  if (s.pendingDelta === 0) return { state: s, operation: null };
  const delta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, s.pendingDelta));
  const op: CounterOperation = {
    kind: "delta",
    operationId,
    activityId: s.activityId,
    delta,
    clientRecordedAt: new Date(now).toISOString(),
  };
  const rest = s.pendingDelta - delta;
  return {
    state: {
      ...s,
      inflight: [...s.inflight, op],
      pendingDelta: rest,
      bufferedSince: rest === 0 ? null : now,
    },
    operation: op,
  };
}

/** Reset after user confirmation: a `set_zero` correction event (PRD §12.4). Unsent taps are dropped. */
export function reset(s: CounterState, operationId: string, now: number): FlushResult {
  const op: CounterOperation = {
    kind: "set_zero",
    operationId,
    activityId: s.activityId,
    clientRecordedAt: new Date(now).toISOString(),
  };
  return {
    state: { ...s, inflight: [...s.inflight, op], pendingDelta: 0, bufferedSince: null },
    operation: op,
  };
}

export interface OperationAck {
  operationId: string;
  status: "accepted" | "duplicate" | "rejected";
  authoritativeCount: number;
}

/** Apply server answers. Rejected operations leave the queue and are reported, never silently dropped. */
export function applyAcks(s: CounterState, acks: readonly OperationAck[]): CounterState {
  let next = s;
  for (const ack of acks) {
    if (!next.inflight.some((o) => o.operationId === ack.operationId)) continue;
    next = {
      ...next,
      inflight: next.inflight.filter((o) => o.operationId !== ack.operationId),
      serverCount: ack.authoritativeCount,
      rejected: ack.status === "rejected" ? [...next.rejected, ack.operationId] : next.rejected,
    };
  }
  return next;
}

/** Take a fresh authoritative count (e.g. after another device synced). */
export function receiveServerCount(s: CounterState, count: number): CounterState {
  return { ...s, serverCount: Math.max(0, count) };
}
