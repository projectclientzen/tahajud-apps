"use client";

import { Check, CloudOff, Minus } from "lucide-react";
import * as React from "react";
import { useData, useOnline } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Sheet, SheetClose } from "@/components/ui/sheet";
import type { SessionActivity } from "@/data";
import {
  displayCount,
  extraCount,
  flush,
  initCounter,
  isTargetReached,
  reset,
  shouldFlush,
  tap,
  type CounterOperation,
  type CounterState,
} from "@/domain/dhikr/counter";
import type { NewQueueItem, QueueItem } from "@/offline";

/** Keeps the screen on while counting, where the browser allows it (PRD §12.1). */
function useWakeLock(enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        /* denied or battery saver: counting still works */
      }
    };
    void acquire();
    const onVisible = () => document.visibilityState === "visible" && void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [enabled]);
}

const TICK_MS = 500;

/** Queue item for one counter operation. The queue stores it, then sends it. */
function toQueueItem(activityId: string, o: CounterOperation): NewQueueItem {
  return o.kind === "delta"
    ? {
        operation_id: o.operationId,
        entity_id: activityId,
        operation_type: "counter_delta",
        payload: { delta: o.delta, client_recorded_at: o.clientRecordedAt },
        client_timestamp: o.clientRecordedAt,
      }
    : {
        operation_id: o.operationId,
        entity_id: activityId,
        operation_type: "counter_set_zero",
        payload: { client_recorded_at: o.clientRecordedAt },
        client_timestamp: o.clientRecordedAt,
      };
}

/** Counter operations still waiting in the queue, for one activity. Used to rebuild the count after a reload. */
export function opsFromQueue(items: QueueItem[], activityId: string): CounterOperation[] {
  return items
    .filter((i) => i.entity_id === activityId && i.sync_status !== "rejected" && i.operation_type !== "checklist_set")
    .sort((a, b) => a.seq - b.seq)
    .map((i) =>
      i.operation_type === "counter_set_zero"
        ? {
            kind: "set_zero" as const,
            operationId: i.operation_id,
            activityId,
            clientRecordedAt: (i.payload as { client_recorded_at: string }).client_recorded_at,
          }
        : {
            kind: "delta" as const,
            operationId: i.operation_id,
            activityId,
            delta: (i.payload as { delta: number }).delta,
            clientRecordedAt: (i.payload as { client_recorded_at: string }).client_recorded_at,
          },
    );
}

/**
 * Tap counter. Display = last server count + operations waiting in the queue + taps not yet queued (PRD §12.3).
 * The domain reducer coalesces taps, then each batch goes into the persistent offline queue, which sends it.
 * Once the queue is empty the server count is read again and replaces the local guess.
 */
export function CounterScreen({
  activity: a,
  initialOps = [],
}: {
  activity: SessionActivity;
  /** Operations from an earlier visit that are still in the queue. */
  initialOps?: CounterOperation[];
}) {
  const { layer, queue, isOpen, registerFlusher } = useData();
  const online = useOnline();
  const [state, setState] = React.useState<CounterState>(() => ({
    ...initCounter(a.id, a.target ?? 0, a.count),
    inflight: initialOps,
  }));
  const stateRef = React.useRef(state);
  const queuing = React.useRef(0);
  const confirming = React.useRef(false);
  const [keepAwake, setKeepAwake] = React.useState(false);
  const [canWake, setCanWake] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [refused, setRefused] = React.useState<QueueItem[]>([]);
  useWakeLock(keepAwake);

  const update = React.useCallback((next: CounterState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  React.useEffect(() => setCanWake("wakeLock" in navigator), []);

  /** Queue empty: read the server count and drop the local operations it already includes. */
  const confirm = React.useCallback(async () => {
    if (!layer || !queue || confirming.current || queuing.current > 0) return;
    const snap = queue.getSnapshot();
    const known = stateRef.current.inflight.map((o) => o.operationId);
    if (snap.pending > 0 || known.length === 0) return;
    confirming.current = true;
    try {
      const session = await layer.session.getActiveSession();
      const fresh = session?.activities.find((x) => x.id === a.id);
      if (!fresh || !isOpen()) return;
      const done = new Set(known);
      update({
        ...stateRef.current,
        serverCount: fresh.count,
        inflight: stateRef.current.inflight.filter((o) => !done.has(o.operationId)),
      });
    } finally {
      confirming.current = false;
    }
  }, [layer, queue, isOpen, update, a.id]);

  const refreshRefused = React.useCallback(async () => {
    if (!queue) return;
    setRefused((await queue.listRejected()).filter((i) => i.entity_id === a.id));
  }, [queue, a.id]);

  React.useEffect(() => {
    if (!queue) return;
    void refreshRefused();
    void confirm();
    return queue.subscribe(() => {
      void confirm();
      void refreshRefused();
    });
  }, [queue, confirm, refreshRefused]);

  const sendBuffer = React.useCallback(() => {
    if (!queue || !isOpen()) return;
    const r = flush(stateRef.current, crypto.randomUUID(), Date.now());
    if (!r.operation) return;
    update(r.state);
    queuing.current += 1;
    void queue.enqueue(toQueueItem(a.id, r.operation)).finally(() => {
      queuing.current -= 1;
      void confirm();
    });
  }, [queue, isOpen, update, confirm, a.id]);

  // Coalesce on the 2 s timer, and flush when the page goes away or sign-out asks for it.
  React.useEffect(() => {
    const tick = window.setInterval(() => {
      if (shouldFlush(stateRef.current, { now: Date.now() })) sendBuffer();
    }, TICK_MS);
    const onHidden = () => document.visibilityState === "hidden" && sendBuffer();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", sendBuffer);
    const unregister = registerFlusher(sendBuffer);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", sendBuffer);
      unregister();
      sendBuffer();
    };
  }, [sendBuffer, registerFlusher]);

  const count = displayCount(state);
  const reached = isTargetReached(state);
  const extra = extraCount(state);
  const unsynced = state.pendingDelta !== 0 || state.inflight.length > 0;

  const wasReached = React.useRef(reached);
  React.useEffect(() => {
    if (reached && !wasReached.current) navigator.vibrate?.(60);
    wasReached.current = reached;
  }, [reached]);

  function onTap(step: 1 | -1) {
    const next = tap(stateRef.current, Date.now(), step);
    update(next);
    // The reducer asks for an immediate flush when the target is crossed.
    if (shouldFlush(next, { now: Date.now() })) sendBuffer();
  }

  function onReset() {
    if (!queue || !isOpen()) return;
    const r = reset(stateRef.current, crypto.randomUUID(), Date.now());
    update(r.state);
    queuing.current += 1;
    void queue.enqueue(toQueueItem(a.id, r.operation!)).finally(() => {
      queuing.current -= 1;
      void confirm();
    });
    setConfirmReset(false);
  }

  return (
    <div className="flex flex-col items-center gap-6">
      {a.arabic_text ? (
        <p lang="ar" className="arabic w-full text-center text-dhikr">
          {a.arabic_text}
        </p>
      ) : null}
      {a.dhikr_review_status && a.dhikr_review_status !== "published" ? (
        <p role="note" className="rounded-full bg-warning-soft px-3 py-1 text-helper text-warning">
          Teks ini belum direview
        </p>
      ) : null}
      {a.guidance ? <p className="max-w-prose text-center text-text-muted">{a.guidance}</p> : null}

      <ProgressRing label={a.title} value={Math.min(count, state.target)} max={Math.max(state.target, 1)} size={176}>
        <span className="flex flex-col items-center leading-tight">
          <span className="text-stat font-semibold tabular-nums" data-testid="count">
            {count}
          </span>
          <span className="text-helper text-text-muted">
            dari {state.target}
            {a.unit ? ` ${a.unit}` : ""}
          </span>
        </span>
      </ProgressRing>

      {reached ? (
        <p
          role="status"
          className="rounded-[var(--radius-control)] bg-success-soft px-4 py-2 text-success"
          data-testid="reached"
        >
          Target tercapai.{extra > 0 ? ` +${extra} lebih.` : " Tap berikutnya tetap dihitung."}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => onTap(1)}
        aria-label="Tambah satu hitungan"
        className="grid size-44 touch-manipulation select-none place-items-center rounded-full bg-primary text-on-primary transition-transform duration-[var(--dur-fast)] active:scale-[0.97]"
      >
        <span aria-hidden className="text-stat font-bold">
          +1
        </span>
      </button>

      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="icon"
          aria-label="Kurangi satu hitungan"
          onClick={() => onTap(-1)}
          disabled={count === 0}
        >
          <Minus aria-hidden className="size-5" />
        </Button>
        <Sheet
          open={confirmReset}
          onOpenChange={setConfirmReset}
          title="Setel ulang hitungan?"
          description="Hitungan kembali ke nol. Riwayat tetap tercatat sebagai koreksi."
          trigger={<Button variant="ghost">Setel ulang</Button>}
        >
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button variant="danger" onClick={onReset}>
              Ya, setel ulang
            </Button>
            <SheetClose asChild>
              <Button variant="ghost">Batal</Button>
            </SheetClose>
          </div>
        </Sheet>
      </div>

      <p className="flex items-center gap-2 text-helper text-text-muted" role="status" data-testid="sync-status">
        {unsynced ? <CloudOff aria-hidden className="size-4" /> : <Check aria-hidden className="size-4" />}
        {unsynced ? (online ? "Tersimpan di perangkat" : "Tersimpan di perangkat, menunggu sinyal") : "Tersinkron"}
      </p>

      {refused.length > 0 ? (
        <div role="alert" className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
          <p>Sesi ini sudah ditutup, jadi sebagian catatan tidak diterima server.</p>
          <Button
            variant="secondary"
            onClick={async () => {
              await queue?.dismissRejected(refused.map((r) => r.operation_id));
              await refreshRefused();
            }}
          >
            Mengerti
          </Button>
        </div>
      ) : null}

      {canWake ? (
        <label className="flex min-h-12 items-center gap-3">
          <input
            type="checkbox"
            className="size-5 accent-[var(--primary)]"
            checked={keepAwake}
            onChange={(e) => setKeepAwake(e.target.checked)}
          />
          Layar tetap menyala
        </label>
      ) : null}
    </div>
  );
}
