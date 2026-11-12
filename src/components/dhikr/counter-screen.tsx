"use client";

import { Check, CloudOff, Minus } from "lucide-react";
import * as React from "react";
import { errorCode, useData } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Sheet, SheetClose } from "@/components/ui/sheet";
import type { SessionActivity } from "@/data";
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
const RETRY_MS = 4_000;

const toContractOp = (o: CounterOperation) =>
  o.kind === "delta"
    ? { kind: "delta" as const, operation_id: o.operationId, delta: o.delta, client_recorded_at: o.clientRecordedAt }
    : { kind: "set_zero" as const, operation_id: o.operationId, client_recorded_at: o.clientRecordedAt };

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
 * Tap counter. Display = last server count + operations in flight + taps not yet sent (PRD §12.3).
 * Taps are coalesced by the domain reducer, so 100 quick taps become a few requests.
 * TODO(S4a): in-flight operations live in memory only. S4a moves them to the IndexedDB queue.
 */
export function CounterScreen({ activity: a }: { activity: SessionActivity }) {
  const { layer } = useData();
  const [state, setState] = React.useState<CounterState>(() => initCounter(a.id, a.target ?? 0, a.count));
  const stateRef = React.useRef(state);
  const sending = React.useRef(false);
  const [offline, setOffline] = React.useState(false);
  const [keepAwake, setKeepAwake] = React.useState(false);
  const [canWake, setCanWake] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);
  useWakeLock(keepAwake);

  const update = React.useCallback((next: CounterState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  React.useEffect(() => setCanWake("wakeLock" in navigator), []);

  const sync = React.useCallback(async () => {
    if (!layer || sending.current) return;
    sending.current = true;
    try {
      while (stateRef.current.inflight.length > 0) {
        const before = stateRef.current.inflight.length;
        const ops = stateRef.current.inflight.slice(0, 50);
        const res = await layer.session.applyCounterOperations(a.id, { operations: ops.map(toContractOp) });
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
        setOffline(false);
        if (stateRef.current.inflight.length >= before) break;
      }
    } catch (e) {
      setOffline(errorCode(e) === "OFFLINE");
    } finally {
      sending.current = false;
    }
  }, [layer, a.id, update]);

  const sendBuffer = React.useCallback(() => {
    const r = flush(stateRef.current, crypto.randomUUID(), Date.now());
    if (r.operation) update(r.state);
    void sync();
  }, [sync, update]);

  // Flush on the 2 s timer, retry unsent operations, and flush when the page goes away.
  React.useEffect(() => {
    const tick = window.setInterval(() => {
      if (shouldFlush(stateRef.current, { now: Date.now() })) sendBuffer();
    }, TICK_MS);
    const retry = window.setInterval(() => {
      if (stateRef.current.inflight.length > 0) void sync();
    }, RETRY_MS);
    const leave = () => sendBuffer();
    const onHidden = () => document.visibilityState === "hidden" && leave();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", leave);
    window.addEventListener("online", sync);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(retry);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("online", sync);
      leave();
    };
  }, [sendBuffer, sync]);

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
    const r = reset(stateRef.current, crypto.randomUUID(), Date.now());
    update(r.state);
    void sync();
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
        {unsynced ? (offline ? "Tersimpan di perangkat, menunggu sinyal" : "Tersimpan di perangkat") : "Tersinkron"}
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
