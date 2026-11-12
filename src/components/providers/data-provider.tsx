"use client";

import * as React from "react";
import { ApiError, createDataLayer, type DataLayer, type MockDataLayer } from "@/data";

const DEMO_USER_ID = "demo-user";

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
}

const DataContext = React.createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [layer, setLayer] = React.useState<DataLayer | null>(null);
  const [version, setVersion] = React.useState(0);
  const [requests, setRequests] = React.useState(0);
  const created = React.useRef<DataLayer | null>(null);

  // Created in an effect: the mock layer opens IndexedDB, which only exists in the browser.
  React.useEffect(() => {
    if (created.current) return;
    const l = createDataLayer({ userId: DEMO_USER_ID });
    const send = l.session.applyCounterOperations.bind(l.session);
    l.session.applyCounterOperations = (id, req) => {
      setRequests((n) => n + 1);
      return send(id, req);
    };
    created.current = l;
    setLayer(l);
  }, []);

  const value = React.useMemo<DataContextValue>(
    () => ({
      layer,
      dev: layer && "dev" in layer ? (layer as MockDataLayer).dev : null,
      version,
      bump: () => setVersion((v) => v + 1),
      requests,
      resetRequests: () => setRequests(0),
    }),
    [layer, version, requests],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = React.useContext(DataContext);
  if (!ctx) throw new Error("useData must be used inside <DataProvider>");
  return ctx;
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
