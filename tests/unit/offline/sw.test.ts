import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

/** Loads public/sw.js into a sandbox with fake Cache Storage, so its routing rules run for real. */
class FakeResponse {
  constructor(
    readonly body: string,
    readonly init: { status?: number; headers?: Record<string, string> } = {},
  ) {}
  get status() {
    return this.init.status ?? 200;
  }
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  get headers() {
    const h = this.init.headers ?? {};
    return { get: (k: string) => h[k.toLowerCase()] ?? null };
  }
  clone() {
    return new FakeResponse(this.body, this.init);
  }
  static error() {
    return new FakeResponse("ERR", { status: 0 });
  }
}

function boot(fetchImpl: (req: FakeReq) => Promise<FakeResponse>) {
  const store = new Map<string, Map<string, FakeResponse>>();
  const puts: string[] = [];
  const listeners: Record<string, (e: unknown) => void> = {};
  const flags = { skipWaiting: 0, claimed: 0 };
  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name)!;
      return {
        addAll: async (urls: string[]) =>
          urls.forEach((u) => m.set(new URL(u, "https://app.test").pathname, new FakeResponse(`pre:${u}`))),
        put: async (k: string | FakeReq, v: FakeResponse) => {
          const key = typeof k === "string" ? k : k.url;
          puts.push(`${name}|${key}`);
          m.set(key, v);
        },
      };
    },
    match: async (k: string | FakeReq) => {
      const key = typeof k === "string" ? k : k.url;
      for (const m of store.values()) {
        const hit = m.get(key) ?? m.get(key.replace("https://app.test", ""));
        if (hit) return hit;
      }
      return undefined;
    },
    keys: async () => [...store.keys()],
    delete: async (k: string) => store.delete(k),
  };
  const self = {
    location: { origin: "https://app.test" },
    addEventListener: (t: string, fn: (e: unknown) => void) => {
      listeners[t] = fn;
    },
    skipWaiting: () => {
      flags.skipWaiting++;
    },
    clients: {
      claim: async () => {
        flags.claimed++;
      },
    },
  };
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self,
    caches,
    fetch: fetchImpl,
    URL,
    Response: FakeResponse,
    console,
  });
  const fire = async (t: string, extra: object = {}) => {
    let respond: Promise<FakeResponse> | undefined;
    let wait: Promise<unknown> | undefined;
    listeners[t]!({
      respondWith: (p: Promise<FakeResponse>) => {
        respond = p;
      },
      waitUntil: (p: Promise<unknown>) => {
        wait = p;
      },
      ...extra,
    });
    await wait;
    return { responded: respond !== undefined, response: respond ? await respond : undefined };
  };
  return { store, puts, fire, flags, caches };
}

interface FakeReq {
  url: string;
  method: string;
  mode: string;
  headers: { get: (k: string) => string | null };
}
const req = (path: string, over: Partial<FakeReq> & { rsc?: boolean } = {}): FakeReq => ({
  url: `https://app.test${path}`,
  method: "GET",
  mode: "cors",
  headers: { get: (k) => (over.rsc && k === "RSC" ? "1" : null) },
  ...over,
});
const okPage = (cc = "s-maxage=31536000") => new FakeResponse("<html>", { headers: { "cache-control": cc } });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("service worker: install, update, activate", () => {
  it("precaches the offline page and icons, and waits for the page before taking over", async () => {
    const w = boot(async () => okPage());
    await w.fire("install");
    expect([...w.store.get("tahajud-static-v1")!.keys()]).toEqual([
      "/offline.html",
      "/icons/icon.svg",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
    ]);
    expect(w.flags.skipWaiting).toBe(0);
    await w.fire("message", { data: { type: "OTHER" } });
    await w.fire("message", { data: null });
    expect(w.flags.skipWaiting).toBe(0);
    await w.fire("message", { data: { type: "SKIP_WAITING" } });
    expect(w.flags.skipWaiting).toBe(1);
  });

  it("removes old tahajud caches, keeps current ones and other sites' caches, then claims clients", async () => {
    const w = boot(async () => okPage());
    for (const n of ["tahajud-static-v0", "tahajud-pages-v0", "tahajud-static-v1", "tahajud-pages-v1", "other-app"])
      await w.caches.open(n);
    await w.fire("activate");
    expect([...w.store.keys()].sort()).toEqual(["other-app", "tahajud-pages-v1", "tahajud-static-v1"]);
    expect(w.flags.claimed).toBe(1);
  });
});

describe("service worker: what it must never touch", () => {
  it.each([
    ["POST", req("/dashboard", { method: "POST" })],
    ["cross-origin", { ...req("/x"), url: "https://cdn.example/x.js" }],
    ["API call", req("/api/v1/me/access")],
    ["API call during navigation", req("/api/v1/me/dashboard", { mode: "navigate" })],
    ["RSC query", req("/dashboard?_rsc=abc")],
    ["RSC header", req("/dashboard", { rsc: true })],
    ["unrelated asset", req("/manifest.webmanifest")],
  ])("%s: no respondWith, nothing cached", async (_n, r) => {
    const w = boot(async () => okPage());
    const out = await w.fire("fetch", { request: r });
    expect(out.responded).toBe(false);
    expect(w.puts).toEqual([]);
  });

  it("PRD §21 no /api/ response ever reaches Cache Storage, even after many calls", async () => {
    const w = boot(async () => new FakeResponse('{"secret":1}'));
    for (const p of ["/api/v1/me", "/api/v1/me/dashboard", "/api/v1/night-sessions/1"])
      await w.fire("fetch", { request: req(p) });
    await tick();
    expect([...w.store.values()].flatMap((m) => [...m.keys()]).filter((k) => k.includes("/api/"))).toEqual([]);
  });
});

describe("service worker: navigation", () => {
  it("serves the network page, keeps a copy of cacheable ones, and falls back to it offline", async () => {
    let online = true;
    const w = boot(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return okPage();
    });
    const nav = req("/dashboard", { mode: "navigate", url: "https://app.test/dashboard?x=1" });
    const a = await w.fire("fetch", { request: nav });
    expect(a.response!.body).toBe("<html>");
    await tick();
    expect(w.puts).toEqual(["tahajud-pages-v1|https://app.test/dashboard"]); // query stripped from the key
    online = false;
    const b = await w.fire("fetch", { request: req("/dashboard", { mode: "navigate" }) });
    expect(b.response!.body).toBe("<html>");
  });

  it("does not keep pages marked private or no-store", async () => {
    for (const cc of ["private, no-store", "no-store", "PRIVATE"]) {
      const w = boot(async () => okPage(cc));
      await w.fire("fetch", { request: req("/profile", { mode: "navigate" }) });
      await tick();
      expect(w.puts).toEqual([]);
    }
  });

  it("shows the offline page for a page never opened before, and an error if even that is missing", async () => {
    const w = boot(async () => {
      throw new TypeError("offline");
    });
    await w.fire("install");
    const r = await w.fire("fetch", { request: req("/baru", { mode: "navigate" }) });
    expect(r.response!.body).toBe("pre:/offline.html");
    const bare = boot(async () => {
      throw new TypeError("offline");
    });
    const e = await bare.fire("fetch", { request: req("/baru", { mode: "navigate" }) });
    expect(e.response!.status).toBe(0);
  });

  it("falls back to a saved copy on a 5xx, and passes the 5xx through when there is none", async () => {
    let status = 200;
    const w = boot(async () => (status === 200 ? okPage() : new FakeResponse("boom", { status })));
    await w.fire("fetch", { request: req("/worship", { mode: "navigate" }) });
    await tick();
    status = 503;
    expect((await w.fire("fetch", { request: req("/worship", { mode: "navigate" }) })).response!.body).toBe("<html>");
    expect((await w.fire("fetch", { request: req("/never", { mode: "navigate" }) })).response!.status).toBe(503);
  });

  it("does not store non-OK pages", async () => {
    const w = boot(async () => new FakeResponse("nope", { status: 404 }));
    await w.fire("fetch", { request: req("/hilang", { mode: "navigate" }) });
    await tick();
    expect(w.puts).toEqual([]);
  });
});

describe("service worker: static files", () => {
  it("serves hashed files and icons cache-first", async () => {
    let calls = 0;
    const w = boot(async () => (calls++, new FakeResponse("js")));
    const r = req("/_next/static/chunks/app.js");
    expect((await w.fire("fetch", { request: r })).response!.body).toBe("js");
    await tick();
    expect((await w.fire("fetch", { request: r })).response!.body).toBe("js");
    expect(calls).toBe(1); // second read came from cache
    expect((await w.fire("fetch", { request: req("/icons/icon-192.png") })).responded).toBe(true);
  });

  it("does not cache a failed static response", async () => {
    const w = boot(async () => new FakeResponse("", { status: 404 }));
    await w.fire("fetch", { request: req("/_next/static/missing.js") });
    await tick();
    expect(w.puts).toEqual([]);
  });
});
