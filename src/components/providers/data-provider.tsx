"use client";

import * as React from "react";
import { ApiError, createDataLayer, type CounterOperationsResponse, type DataLayer, type MockDataLayer } from "@/data";
import { OfflineQueue, bindQueueTriggers, browserTriggerEnv, createLayerSender, type QueueSnapshot } from "@/offline";
import { useAuth, useUserId } from "./auth-provider";

type AckListener = (activityId: string, res: CounterOperationsResponse) => void;

interface DataContextValue {
  layer: DataLayer | null;
  /** Id of the user this layer belongs to. */
  userId: string | null;
  /** Offline queue of this user (PRD §21.2). Null until the layer exists. */
  queue: OfflineQueue | null;
  /** Server answers to counter requests, whoever sent them (the queue sends in the background). */
  subscribeAcks: (fn: AckListener) => () => void;
  /** Screens with taps not yet in the queue register here, so logout can save them first. */
  registerFlusher: (fn: () => void) => () => void;
  /** Ask every registered screen to put its buffered taps into the queue. */
  flushScreens: () => void;
  /** Dev tools exist only on the mock layer. */
  dev: MockDataLayer["dev"] | null;
  /** Bumped after any change that should refetch every screen (dev panel, writes). */
  version: number;
  bump: () => void;
  /** Counter-operation requests sent since the last reset. The dev panel shows it. */
  requests: number;
  resetRequests: () => void;
}

const DataContext = React.createContext<DataContextValue | null>(null);

interface Bundle {
  userId: string;
  layer: DataLayer;
  queue: OfflineQueue;
}

/**
 * Data layer and offline queue for the signed-in user. Both are rebuilt when the user changes and dropped at
 * sign-out, so one person's notes never reach another person's account (PRD §21.3).
 */
export function DataProvider({ children }: { children: React.ReactNode }) {
  const { auth, authDev } = useAuth();
  const userId = useUserId();
  const [bundle, setBundle] = React.useState<Bundle | null>(null);
  const [version, setVersion] = React.useState(0);
  const [requests, setRequests] = React.useState(0);
  const listeners = React.useRef(new Set<AckListener>());
  const flushers = React.useRef(new Set<() => void>());

  const subscribeAcks = React.useCallback((fn: AckListener) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  const registerFlusher = React.useCallback((fn: () => void) => {
    flushers.current.add(fn);
    return () => void flushers.current.delete(fn);
  }, []);
  const flushScreens = React.useCallback(() => {
    for (const fn of flushers.current) fn();
  }, []);

  React.useEffect(() => {
    if (!auth || !userId) {
      setBundle(null);
      return;
    }
    let cancelled = false;
    let unbind: (() => void) | null = null;
    void (async () => {
      // Mock only: the first time a user appears, their demo data starts from what their entitlement says.
      const scenario = authDev ? await authDev.seedFor(userId) : undefined;
      if (cancelled) return;
      const l = createDataLayer({ userId, scenario });
      const send = l.session.applyCounterOperations.bind(l.session);
      l.session.applyCounterOperations = async (id, req) => {
        setRequests((n) => n + 1);
        const res = await send(id, req);
        for (const fn of listeners.current) fn(id, res);
        return res;
      };
      const queue = new OfflineQueue({ userId, sender: createLayerSender(l) });
      unbind = bindQueueTriggers(queue, browserTriggerEnv());
      setBundle({ userId, layer: l, queue });
    })();
    return () => {
      cancelled = true;
      unbind?.();
    };
  }, [auth, authDev, userId]);

  const layer = bundle?.layer ?? null;
  const value = React.useMemo<DataContextValue>(
    () => ({
      layer,
      userId: bundle?.userId ?? null,
      queue: bundle?.queue ?? null,
      subscribeAcks,
      registerFlusher,
      flushScreens,
      dev: layer && "dev" in layer ? (layer as MockDataLayer).dev : null,
      version,
      bump: () => setVersion((v) => v + 1),
      requests,
      resetRequests: () => setRequests(0),
    }),
    [layer, bundle, subscribeAcks, registerFlusher, flushScreens, version, requests],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = React.useContext(DataContext);
  if (!ctx) throw new Error("useData must be used inside <DataProvider>");
  return ctx;
}

const NO_QUEUE: QueueSnapshot = { pending: 0, rejected: 0, lastSyncedAt: null, flushing: false, lastError: null };
const noopSubscribe = () => () => undefined;

/** Live view of the offline queue: how many notes wait, how many were refused. */
export function useQueueSnapshot(): QueueSnapshot {
  const { queue } = useData();
  return React.useSyncExternalStore(
    queue ? queue.subscribe : noopSubscribe,
    queue ? queue.getSnapshot : () => NO_QUEUE,
    () => NO_QUEUE,
  );
}

export const errorCode = (e: unknown) => (e instanceof ApiError ? e.code : null);
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Terjadi kesalahan. Coba lagi.");

interface LoadState<T> {
  data: T | null;
  error: unknown;
  /** True until the first answer. Reloads keep the old data on screen. */
  loading: boolean;
}

/** Run a data-layer read. Refetches when `version` is bumped or `deps` change. No cache layer: see S3 decisions. */
export function useLoad<T>(load: (layer: DataLayer) => Promise<T>, deps: React.DependencyList = []) {
  const { layer, version } = useData();
  const [state, setState] = React.useState<LoadState<T>>({ data: null, error: null, loading: true });
  const [tick, setTick] = React.useState(0);
  const loadRef = React.useRef(load);
  loadRef.current = load;

  React.useEffect(() => {
    if (!layer) return;
    let alive = true;
    loadRef.current(layer).then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error: unknown) => alive && setState((s) => ({ data: s.data, error, loading: false })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, version, tick, ...deps]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}

/** Current time from the mock clock when time travel is active, real time otherwise. */
export function useNow(intervalMs = 1000): Date | null {
  const { dev, version } = useData();
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    const read = () => setNow(dev ? dev.now() : new Date());
    read();
    const id = window.setInterval(read, intervalMs);
    return () => window.clearInterval(id);
  }, [dev, version, intervalMs]);
  return now;
}
