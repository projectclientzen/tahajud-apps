"use client";

import * as React from "react";
import { ApiError, createDataLayer, type DataLayer, type MockDataLayer } from "@/data";
import { OfflineQueue, bindQueueTriggers, browserTriggerEnv, createLayerSender } from "@/offline";

interface DataContextValue {
  layer: DataLayer | null;
  /** Dev tools exist only on the mock layer. */
  dev: MockDataLayer["dev"] | null;
  /** Bumped after any change that should refetch every screen (dev panel, writes). */
  version: number;
  bump: () => void;
  /** Counter-operation requests sent since the last reset. The dev panel shows it. */
  requests: number;
  resetRequests: () => void;
  /** Signed-in user this layer belongs to. */
  userId: string;
  /** Offline mutation queue for this user. Counter taps go in here before they go out. */
  queue: OfflineQueue | null;
  /** False once the user has signed out and local data was removed. Nothing may write after that. */
  isOpen: () => boolean;
  /** Stop syncing and drop the layer. Called by sign-out just before the local database is deleted. */
  shutdown: () => void;
  /** Screens with unsent buffers register here so sign-out can flush them first. */
  registerFlusher: (fn: () => void) => () => void;
  flushAll: () => void;
}

const DataContext = React.createContext<DataContextValue | null>(null);

export function DataProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [layer, setLayer] = React.useState<DataLayer | null>(null);
  const [queue, setQueue] = React.useState<OfflineQueue | null>(null);
  const [version, setVersion] = React.useState(0);
  const [requests, setRequests] = React.useState(0);
  const open = React.useRef(false);
  const stopTriggers = React.useRef<(() => void) | null>(null);
  const flushers = React.useRef(new Set<() => void>());

  // Created in an effect: the mock layer opens IndexedDB, which only exists in the browser.
  React.useEffect(() => {
    const l = createDataLayer({ userId });
    const send = l.session.applyCounterOperations.bind(l.session);
    l.session.applyCounterOperations = (id, req) => {
      setRequests((n) => n + 1);
      return send(id, req);
    };
    const q = new OfflineQueue({ userId, sender: createLayerSender(l) });
    stopTriggers.current = bindQueueTriggers(q, browserTriggerEnv());
    open.current = true;
    setLayer(l);
    setQueue(q);
    return () => {
      stopTriggers.current?.();
      stopTriggers.current = null;
    };
  }, [userId]);

  // Dev tools and writes can change what the server would now accept, so try the queue again.
  React.useEffect(() => {
    if (version > 0) void queue?.flushNow();
  }, [version, queue]);

  const value = React.useMemo<DataContextValue>(
    () => ({
      layer,
      dev: layer && "dev" in layer ? (layer as MockDataLayer).dev : null,
      version,
      bump: () => setVersion((v) => v + 1),
      requests,
      resetRequests: () => setRequests(0),
      userId,
      queue,
      isOpen: () => open.current,
      shutdown: () => {
        open.current = false;
        stopTriggers.current?.();
        stopTriggers.current = null;
        setLayer(null);
        setQueue(null);
      },
      registerFlusher: (fn) => {
        flushers.current.add(fn);
        return () => void flushers.current.delete(fn);
      },
      flushAll: () => flushers.current.forEach((fn) => fn()),
    }),
    [layer, queue, version, requests, userId],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

/** For components that also render where no user is signed in (login pages). */
export function useDataOptional(): DataContextValue | null {
  return React.useContext(DataContext);
}

export function useData(): DataContextValue {
  const ctx = React.useContext(DataContext);
  if (!ctx) throw new Error("useData must be used inside <DataProvider>");
  return ctx;
}

export const errorCode = (e: unknown) => (e instanceof ApiError ? e.code : null);
/** Only messages written for users (ApiError) reach the screen; a raw JS error never does. */
export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : "Terjadi kesalahan. Coba lagi.");

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

/** Browser connection state, for labels such as "menunggu sinyal". */
export function useOnline(): boolean {
  const [online, setOnline] = React.useState(true);
  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
