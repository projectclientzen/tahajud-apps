/**
 * Service worker registration and update state. `public/sw.js` is the worker.
 * Registers only in production, or when NEXT_PUBLIC_ENABLE_SW=true (PRD §16.3).
 */
export type SwUpdateState = { updateReady: boolean; registered: boolean };

export interface SwEnv {
  serviceWorker?: Pick<ServiceWorkerContainer, "register" | "addEventListener" | "controller">;
  enabled: boolean;
  reload: () => void;
}

export const swEnabled = (env: { NODE_ENV?: string; NEXT_PUBLIC_ENABLE_SW?: string }): boolean =>
  env.NODE_ENV === "production" || env.NEXT_PUBLIC_ENABLE_SW === "true";

type Listener = () => void;

/** Tiny store so `useSyncExternalStore` can read the update state. */
export class SwStore {
  private snap: SwUpdateState = { updateReady: false, registered: false };
  private listeners = new Set<Listener>();
  private waiting: ServiceWorker | null = null;

  getSnapshot = (): SwUpdateState => this.snap;
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private set(p: Partial<SwUpdateState>) {
    this.snap = { ...this.snap, ...p };
    for (const l of this.listeners) l();
  }

  /** Registers the worker and tracks a waiting update. Safe to call twice. */
  async register(env: SwEnv): Promise<void> {
    const sw = env.serviceWorker;
    if (!env.enabled || !sw || this.snap.registered) return;
    const reg = await sw.register("/sw.js", { scope: "/" });
    this.set({ registered: true });
    const hadController = !!sw.controller;
    const track = (r: ServiceWorkerRegistration) => {
      // A waiting worker next to a live controller means a new version is ready.
      if (r.waiting && hadController) {
        this.waiting = r.waiting;
        this.set({ updateReady: true });
      }
    };
    track(reg);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => {
        if (w.state === "installed") track(reg);
      });
    });
    sw.addEventListener("controllerchange", () => {
      if (hadController) env.reload();
    });
  }

  /** User accepted the update: tell the waiting worker to take over. The page reloads on controllerchange. */
  applyUpdate(): void {
    this.waiting?.postMessage({ type: "SKIP_WAITING" });
  }
}

export const swStore = new SwStore();
