"use client";

import { Check, CloudOff, Minus } from "lucide-react";
import * as React from "react";
import { useData, useQueueSnapshot } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Sheet, SheetClose } from "@/components/ui/sheet";
import type { SessionActivity } from "@/data";
import type { QueueItem } from "@/offline";
import {
  applyAcks,
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

const TICK_MS = 500;

/** A note saved in the offline queue, as the counter reducer understands it. */
function fromQueueItem(it: QueueItem, activityId: string): CounterOperation | null {
  if (it.operation_type === "counter_delta") {
    const p = it.payload as { delta: number; client_recorded_at: string };
    return {
      kind: "delta",
      operationId: it.operation_id,
      activityId,
      delta: p.delta,
      clientRecordedAt: p.client_recorded_at,
    };
  }
  if (it.operation_type === "counter_set_zero") {
    const p = it.payload as { client_recorded_at: string };
    return { kind: "set_zero", operationId: it.operation_id, activityId, clientRecordedAt: p.client_recorded_at };
  }
  return null;
}

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

/**
 * Tap counter. Display = last server count + notes not yet acknowledged + taps not yet saved (PRD §12.3).
 * Taps are coalesced by the domain reducer, so 100 quick taps become a few notes. Every note goes into the
 * offline queue (IndexedDB) first and is sent from there, so a reload, a dead connection, or a closed tab
 * never loses a count (PRD §21.2). The queue retries and the server ignores a note it already has.
 */
export function CounterScreen({ activity: a }: { activity: SessionActivity }) {
  const { queue, subscribeAcks, registerFlusher } = useData();
  const snap = useQueueSnapshot();
  const [state, setState] = React.useState<CounterState>(() => initCounter(a.id, a.target ?? 0, a.count));
  const stateRef = React.useRef(state);
  const [online, setOnline] = React.useState(true);
  const [keepAwake, setKeepAwake] = React.useState(false);
  const [canWake, setCanWake] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);
  useWakeLock(keepAwake);

  const update = React.useCallback((next: CounterState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  React.useEffect(() => setCanWake("wakeLock" in navigator), []);

  React.useEffect(() => {
    const sync = () => setOnline(navigator.onLine !== false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // Notes saved earlier (before a reload, or while offline) still count on screen until the server confirms them.
  React.useEffect(() => {
    if (!queue) return;
    let alive = true;
    void queue.listPending(a.id).then((items) => {
      if (!alive) return;
      const known = new Set(stateRef.current.inflight.map((o) => o.operationId));
      const ops = items
        .map((it) => fromQueueItem(it, a.id))
        .filter((o): o is CounterOperation => o !== null && !known.has(o.operationId));
      if (ops.length > 0) update({ ...stateRef.current, inflight: [...ops, ...stateRef.current.inflight] });
    });
    return () => {
      alive = false;
    };
  }, [queue, a.id, update]);

  // The queue sends in the background. When the server answers, take its count as the truth.
  React.useEffect(
    () =>
      subscribeAcks((activityId, res) => {
        if (activityId !== a.id) return;
        update(
          applyAcks(
            stateRef.current,
            res.results.map((r) => ({
              operationId: r.operation_id,
              status: r.status,
              authoritativeCount: r.authoritative_count,
            })),
          ),
        );
      }),
    [subscribeAcks, a.id, update],
  );

  const sendBuffer = React.useCallback(() => {
    const r = flush(stateRef.current, crypto.randomUUID(), Date.now());
    const op = r.operation;
    if (!op || op.kind !== "delta") return;
    update(r.state);
    void queue?.enqueue({
      operation_id: op.operationId,
      entity_id: a.id,
      operation_type: "counter_delta",
      payload: { delta: op.delta, client_recorded_at: op.clientRecordedAt },
    });
  }, [queue, a.id, update]);

  // Logout asks every counter to save its buffered taps first (DZIKIR-06).
  React.useEffect(() => registerFlusher(sendBuffer), [registerFlusher, sendBuffer]);

  // Save the buffer on the 2 s timer and when the page goes away.
  React.useEffect(() => {
    const tick = window.setInterval(() => {
      if (shouldFlush(stateRef.current, { now: Date.now() })) sendBuffer();
    }, TICK_MS);
    const leave = () => sendBuffer();
    const onHidden = () => document.visibilityState === "hidden" && leave();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", leave);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [sendBuffer]);

  const count = displayCount(state);
  const reached = isTargetReached(state);
  const extra = extraCount(state);
  const waiting = !online || snap.lastError === "OFFLINE";
  const unsynced = state.pendingDelta !== 0 || state.inflight.length > 0 || snap.pending > 0;

  const wasReached = React.useRef(reached);
  React.useEffect(() => {
    if (reached && !wasReached.current) navigator.vibrate?.(60);
    wasReached.current = reached;
  }, [reached]);

  function onTap(step: 1 | -1) {
    const next = tap(stateRef.current, Date.now(), step);
    update(next);
    // The reducer asks for an immediate save when the target is crossed.
    if (shouldFlush(next, { now: Date.now() })) sendBuffer();
  }

  function onReset() {
    const r = reset(stateRef.current, crypto.randomUUID(), Date.now());
    update(r.state);
    if (r.operation) {
      void queue?.enqueue({
        operation_id: r.operation.operationId,
        entity_id: a.id,
        operation_type: "counter_set_zero",
        payload: { client_recorded_at: r.operation.clientRecordedAt },
      });
    }
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
        {unsynced ? (waiting ? "Tersimpan di perangkat, menunggu sinyal" : "Tersimpan di perangkat") : "Tersinkron"}
      </p>

      {state.rejected.length > 0 ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
          Sesi ini sudah ditutup, jadi sebagian catatan tidak diterima server.
        </p>
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
