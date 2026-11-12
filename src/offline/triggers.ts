import type { OfflineQueue } from "./queue";

export interface TriggerEnv {
  win: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  doc: Pick<EventTarget, "addEventListener" | "removeEventListener"> & { visibilityState: string };
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  now: () => number;
}

/**
 * Sends the queue when the app opens, when the connection returns, when the tab becomes visible,
 * and when the next backoff time arrives. Returns a cleanup function.
 */
export function bindQueueTriggers(queue: OfflineQueue, env: TriggerEnv): () => void {
  let timer: unknown = null;
  let stopped = false;

  const arm = async () => {
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
    const at = await queue.nextAttemptAt();
    if (stopped || at === null) return;
    timer = env.setTimeout(
      () => {
        timer = null;
        void run(false);
      },
      Math.max(0, at - env.now()),
    );
  };

  const run = async (force: boolean) => {
    await (force ? queue.flushNow() : queue.flushDue());
    await arm();
  };

  const onOnline = () => void run(true);
  const onVisible = () => {
    if (env.doc.visibilityState === "visible") void run(false);
  };
  env.win.addEventListener("online", onOnline);
  env.doc.addEventListener("visibilitychange", onVisible);
  const unsub = queue.subscribe(() => void arm());
  void run(false); // app open

  return () => {
    stopped = true;
    if (timer !== null) env.clearTimeout(timer);
    env.win.removeEventListener("online", onOnline);
    env.doc.removeEventListener("visibilitychange", onVisible);
    unsub();
  };
}

export const browserTriggerEnv = (): TriggerEnv => ({
  win: window,
  doc: document,
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
  now: () => Date.now(),
});
