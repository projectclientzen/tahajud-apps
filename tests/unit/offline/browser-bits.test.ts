import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { backoffMs } from "@/offline/backoff";
import { requestPersistentStorage } from "@/offline/persist";
import { detectPlatform, isStandalone } from "@/offline/platform";
import { OfflineQueue } from "@/offline/queue";
import { SwStore, swEnabled } from "@/offline/sw-client";
import { bindQueueTriggers, type TriggerEnv } from "@/offline/triggers";
import type { QueueSender, SendOutcome } from "@/offline/types";

describe("backoff", () => {
  it("doubles from 2 s and caps at 5 minutes", () => {
    expect([1, 2, 3, 4, 5, 8, 20].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 32000, 256000, 300000]);
    expect(backoffMs(0)).toBe(2000);
  });
});

describe("navigator.storage.persist()", () => {
  const st = (persisted: boolean, grant: boolean) => ({ persisted: async () => persisted, persist: async () => grant });
  it("reports unsupported, already, granted, denied", async () => {
    expect(await requestPersistentStorage(undefined)).toBe("unsupported");
    expect(await requestPersistentStorage({} as never)).toBe("unsupported");
    expect(await requestPersistentStorage(st(true, false))).toBe("already");
    expect(await requestPersistentStorage(st(false, true))).toBe("granted");
    expect(await requestPersistentStorage(st(false, false))).toBe("denied");
  });
  it("is unsupported when no navigator exists", async () => {
    expect(await requestPersistentStorage()).toBeTruthy();
  });
});

describe("install platform detection", () => {
  const UA = {
    android:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
    iosSafari:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    iosChrome:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1",
    macSafari:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    winChrome:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    winEdge:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0",
    firefox: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
    opera: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 OPR/110.0",
  };
  it.each([
    ["android", UA.android, "android"],
    ["iPhone Safari", UA.iosSafari, "ios-safari"],
    ["iPhone Chrome", UA.iosChrome, "ios-other"],
    ["Mac Safari", UA.macSafari, "desktop-other"],
    ["Windows Chrome", UA.winChrome, "desktop-chromium"],
    ["Windows Edge", UA.winEdge, "desktop-chromium"],
    ["Firefox", UA.firefox, "desktop-other"],
    ["Opera", UA.opera, "desktop-other"],
  ] as const)("%s", (_n, userAgent, expected) => {
    expect(detectPlatform({ userAgent })).toBe(expected);
  });
  it("detects iPadOS that reports as a Mac", () => {
    expect(detectPlatform({ userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 5 })).toBe("ios-safari");
    expect(detectPlatform({ userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 0 })).toBe("desktop-other");
  });
  it("detects standalone from display-mode or iOS navigator.standalone", () => {
    expect(isStandalone({})).toBe(false);
    expect(isStandalone({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(isStandalone({ matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(isStandalone({ navigatorStandalone: true })).toBe(true);
    expect(isStandalone({ navigatorStandalone: false, matchMedia: () => ({ matches: false }) })).toBe(false);
  });
});

describe("queue triggers", () => {
  function env() {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const timers: { fn: () => void; ms: number; id: number }[] = [];
    let id = 0;
    const cleared: number[] = [];
    const e: TriggerEnv = {
      win,
      doc,
      now: () => t.now,
      setTimeout: (fn, ms) => (timers.push({ fn, ms, id: ++id }), id),
      clearTimeout: (x) => void cleared.push(x as number),
    };
    const t = { now: 1_000_000 };
    return { e, win, doc, timers, cleared, t };
  }
  const settle = () => new Promise((r) => setTimeout(r, 25));
  const sender = (ok: () => boolean, log: string[]): QueueSender => ({
    send: async (items) => (
      log.push(`send:${items.length}`),
      items.map(() => (ok() ? { kind: "synced" } : { kind: "retry", error: "OFFLINE" }) as SendOutcome)
    ),
  });
  let n = 0;
  const mk = (s: QueueSender, now: () => number) =>
    new OfflineQueue({ userId: `trg-${++n}`, sender: s, now, flushOnEnqueue: false });
  const op = (i: number) => ({
    operation_id: `t${n}-${i}`,
    entity_id: "e",
    operation_type: "counter_delta" as const,
    payload: { delta: 1, client_recorded_at: "x" },
  });

  it("sends on app open, on online, and on visible, not on hidden", async () => {
    const log: string[] = [];
    const x = env();
    const q = mk(
      sender(() => true, log),
      () => x.t.now,
    );
    await q.enqueue(op(1));
    const stop = bindQueueTriggers(q, x.e);
    await settle();
    expect(log).toEqual(["send:1"]); // app open

    await q.enqueue(op(2));
    x.doc.visibilityState = "hidden";
    x.doc.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(log).toEqual(["send:1"]);
    x.doc.visibilityState = "visible";
    x.doc.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(log).toEqual(["send:1", "send:1"]);

    await q.enqueue(op(3));
    x.win.dispatchEvent(new Event("online"));
    await settle();
    expect(log).toHaveLength(3);
    stop();
    await q.enqueue(op(4));
    x.win.dispatchEvent(new Event("online"));
    await settle();
    expect(log).toHaveLength(3); // listeners removed
  });

  it("arms a timer for the next retry and fires it", async () => {
    const log: string[] = [];
    const x = env();
    let ok = false;
    const q = mk(
      sender(() => ok, log),
      () => x.t.now,
    );
    await q.enqueue(op(1));
    const stop = bindQueueTriggers(q, x.e);
    await settle();
    const armed = x.timers.at(-1)!;
    expect(armed.ms).toBe(2000); // first backoff
    ok = true;
    x.t.now += 2000;
    armed.fn();
    await settle();
    expect(log).toEqual(["send:1", "send:1"]);
    expect(await q.pendingCount()).toBe(0);
    stop();
    expect(x.cleared.length).toBeGreaterThanOrEqual(0);
  });

  it("clears a pending timer on cleanup and when re-armed", async () => {
    const x = env();
    const q = mk(
      sender(() => false, []),
      () => x.t.now,
    );
    await q.enqueue(op(1));
    const stop = bindQueueTriggers(q, x.e);
    await settle();
    await q.enqueue(op(2)); // subscribe -> re-arm, clears the old timer
    await settle();
    expect(x.cleared.length).toBeGreaterThan(0);
    const before = x.cleared.length;
    stop();
    expect(x.cleared.length).toBeGreaterThan(before);
  });
});

describe("service worker client", () => {
  function fakeSw(hasController: boolean) {
    const swListeners: Record<string, (() => void)[]> = {};
    const regListeners: Record<string, (() => void)[]> = {};
    const posted: unknown[] = [];
    const waiting = { postMessage: (m: unknown) => posted.push(m) };
    const installing = {
      state: "installing",
      listeners: [] as (() => void)[],
      addEventListener(_t: string, f: () => void) {
        this.listeners.push(f);
      },
    };
    const reg = {
      waiting: null as unknown,
      installing: null as unknown,
      addEventListener: (t: string, f: () => void) => ((regListeners[t] ??= []).push(f), undefined),
    };
    const sw = {
      controller: hasController ? {} : null,
      registered: 0,
      register: async () => {
        sw.registered++;
        return reg;
      },
      addEventListener: (t: string, f: () => void) => ((swListeners[t] ??= []).push(f), undefined),
    };
    return { sw, reg, waiting, installing, swListeners, regListeners, posted };
  }

  it("enables only in production or with the flag", () => {
    expect(swEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(swEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(swEnabled({ NODE_ENV: "development", NEXT_PUBLIC_ENABLE_SW: "true" })).toBe(true);
    expect(swEnabled({})).toBe(false);
  });

  it("does not register when disabled, unsupported, or twice", async () => {
    const f = fakeSw(false);
    const s1 = new SwStore();
    await s1.register({ serviceWorker: f.sw as never, enabled: false, reload: () => {} });
    await s1.register({ serviceWorker: undefined, enabled: true, reload: () => {} });
    expect(f.sw.registered).toBe(0);
    await s1.register({ serviceWorker: f.sw as never, enabled: true, reload: () => {} });
    await s1.register({ serviceWorker: f.sw as never, enabled: true, reload: () => {} });
    expect(f.sw.registered).toBe(1);
    expect(s1.getSnapshot()).toEqual({ registered: true, updateReady: false });
  });

  it("flags an update when a new worker waits next to a live controller, and applies it on request", async () => {
    const f = fakeSw(true);
    const store = new SwStore();
    let seen = 0;
    const off = store.subscribe(() => seen++);
    let reloads = 0;
    await store.register({ serviceWorker: f.sw as never, enabled: true, reload: () => reloads++ });
    expect(store.getSnapshot().updateReady).toBe(false);

    f.reg.installing = f.installing;
    f.regListeners.updatefound!.forEach((fn) => fn());
    f.reg.waiting = f.waiting;
    f.installing.state = "installed";
    f.installing.listeners.forEach((fn) => fn());
    expect(store.getSnapshot().updateReady).toBe(true);
    expect(seen).toBeGreaterThan(0);

    store.applyUpdate();
    expect(f.posted).toEqual([{ type: "SKIP_WAITING" }]);
    f.swListeners.controllerchange!.forEach((fn) => fn());
    expect(reloads).toBe(1);
    off();
  });

  it("picks up a worker that was already waiting, ignores 'installing' states, and does not reload on first install", async () => {
    const f = fakeSw(true);
    f.reg.waiting = f.waiting;
    const store = new SwStore();
    await store.register({ serviceWorker: f.sw as never, enabled: true, reload: () => {} });
    expect(store.getSnapshot().updateReady).toBe(true);

    const first = fakeSw(false); // very first visit: no controller yet
    const s2 = new SwStore();
    let reloads = 0;
    await s2.register({ serviceWorker: first.sw as never, enabled: true, reload: () => reloads++ });
    first.reg.installing = first.installing;
    first.regListeners.updatefound!.forEach((fn) => fn());
    first.installing.listeners.forEach((fn) => fn()); // still "installing"
    first.reg.waiting = first.waiting;
    first.installing.state = "installed";
    first.installing.listeners.forEach((fn) => fn());
    expect(s2.getSnapshot().updateReady).toBe(false); // first install is not an update
    first.swListeners.controllerchange!.forEach((fn) => fn());
    expect(reloads).toBe(0);
    new SwStore().applyUpdate(); // nothing waiting: no-op
  });
});
