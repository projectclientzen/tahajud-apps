"use client";

import * as React from "react";
import { errorMessage, useData } from "@/components/providers/data-provider";
import type { KhatamResponse } from "@/data";
import {
  applyPending,
  computeKhatam,
  type KhatamState,
  type KhatamView,
  type PendingOp,
  type Prayer,
} from "@/domain/khatam";
import type { KhatamMarkPayload, KhatamSlotPayload, QueueItem } from "@/offline";

const KHATAM_TYPES = new Set(["khatam_slot_set", "khatam_mark"]);

function toOps(items: QueueItem[]): PendingOp[] {
  return items
    .filter((i) => KHATAM_TYPES.has(i.operation_type))
    .map((i) =>
      i.operation_type === "khatam_slot_set"
        ? { kind: "slot" as const, ...(i.payload as KhatamSlotPayload) }
        : { kind: "mark" as const, page: (i.payload as KhatamMarkPayload).page },
    );
}

export interface KhatamHook {
  loading: boolean;
  error: unknown;
  /** True once the server answered and there is no target yet. */
  empty: boolean;
  view: KhatamView | null;
  /** Raw target, for screens that need the id or dates. */
  state: KhatamState | null;
  /** Message to show once, for example a note the server refused. */
  notice: string | null;
  clearNotice(): void;
  reload(): void;
  createTarget(n: number): Promise<void>;
  changeTarget(n: number): Promise<void>;
  /** Goes through the offline queue first. */
  setSlot(day: number, prayer: Prayer, done: boolean): Promise<void>;
  markPage(page: number): Promise<void>;
}

/**
 * Khatam state for the screens. The server holds the target and the ticks; this adds what is still waiting in the
 * offline queue (shown at once) and works the view out with src/domain/khatam. Day numbers use the server clock
 * (corrected for the phone's clock drift) and the timezone saved on the target.
 */
export function useKhatam(): KhatamHook {
  const { layer, queue, version } = useData();
  const [server, setServer] = React.useState<KhatamResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);
  const [pending, setPending] = React.useState<PendingOp[]>([]);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);
  const skew = React.useRef(0);
  const hadPending = React.useRef(false);

  React.useEffect(() => {
    if (!layer) return;
    let alive = true;
    layer.khatam.getKhatam().then(
      (res) => {
        if (!alive) return;
        skew.current = Date.parse(res.server_now) - Date.now();
        setServer(res);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (!alive) return;
        setError(e);
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [layer, version, tick]);

  React.useEffect(() => {
    if (!queue) return;
    let alive = true;
    const sync = async () => {
      const items = await queue.listPending();
      const refused = (await queue.listRejected()).filter((i) => KHATAM_TYPES.has(i.operation_type));
      if (!alive) return;
      const ops = toOps(items);
      setPending(ops);
      if (refused.length > 0) {
        await queue.dismissRejected(refused.map((i) => i.operation_id));
        if (alive) setNotice("Satu catatan baca tidak diterima server. Muat ulang untuk melihat posisi terbaru.");
      }
      // Queue drained or something was refused: read the server value again.
      if ((hadPending.current && ops.length === 0) || refused.length > 0) setTick((t) => t + 1);
      hadPending.current = ops.length > 0;
    };
    void sync();
    const off = queue.subscribe(() => void sync());
    return () => {
      alive = false;
      off();
    };
  }, [queue]);

  const state = React.useMemo<KhatamState | null>(() => {
    const t = server?.target;
    if (!server || !t) return null;
    return applyPending(
      { khatamCount: t.khatam_count, startDate: t.start_date, timezone: t.timezone, adjustment: t.adjustment, reads: server.reads },
      pending,
    );
  }, [server, pending]);

  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    // Re-evaluate the day every minute so the screen follows midnight without a reload.
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const view = React.useMemo(
    () => (state ? computeKhatam(state, new Date(now + skew.current)) : null),
    [state, now],
  );
  // `now` is read after the server answered, so a fresh answer must refresh it once.
  React.useEffect(() => setNow(Date.now()), [server]);

  const run = React.useCallback(async (fn: () => Promise<KhatamResponse>) => {
    try {
      const res = await fn();
      skew.current = Date.parse(res.server_now) - Date.now();
      setServer(res);
      setError(null);
      setNotice(null);
    } catch (e) {
      setNotice(errorMessage(e));
      throw e;
    }
  }, []);

  return {
    loading,
    error,
    empty: !loading && server !== null && server.target === null,
    view,
    state,
    notice,
    clearNotice: () => setNotice(null),
    reload: () => setTick((t) => t + 1),
    createTarget: (n) => run(() => layer!.khatam.createTarget({ khatam_count: n })),
    changeTarget: (n) => run(() => layer!.khatam.changeTarget({ khatam_count: n })),
    async setSlot(day, prayer, done) {
      if (!queue) return;
      await queue.enqueue({
        operation_id: crypto.randomUUID(),
        entity_id: `khatam:${day}:${prayer}`,
        operation_type: "khatam_slot_set",
        payload: { day, prayer, done },
      });
    },
    async markPage(page) {
      if (!queue) return;
      await queue.enqueue({
        operation_id: crypto.randomUUID(),
        entity_id: "khatam:position",
        operation_type: "khatam_mark",
        payload: { page },
      });
    },
  };
}
