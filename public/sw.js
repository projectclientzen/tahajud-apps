/* Tahajud Tracker service worker. Caches the app shell and static files only. */
// Bump VERSION to drop old caches on the next activate. shortcut: manual bump, automate with the build id later.
const VERSION = "v1";
const STATIC = `tahajud-static-${VERSION}`;
const PAGES = `tahajud-pages-${VERSION}`;
const KEEP = [STATIC, PAGES];
const PRECACHE = ["/offline.html", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)));
});

// A new version waits until the page asks for it, so an update never swaps code under an open counter.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("tahajud-") && !KEEP.includes(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // PRD §21: API responses are never cached, and the worker does not touch them at all.
  if (url.pathname.startsWith("/api/")) return;
  // Next.js RSC payloads for client navigation always go to the network.
  if (url.searchParams.has("_rsc") || req.headers.get("RSC")) return;

  if (req.mode === "navigate") {
    event.respondWith(navigate(req, url));
  } else if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(req));
  }
});

async function navigate(req, url) {
  const key = url.origin + url.pathname;
  try {
    const res = await fetch(req);
    if (res.ok && cacheable(res)) {
      const copy = res.clone();
      caches.open(PAGES).then((c) => c.put(key, copy));
    } else if (res.status >= 500) {
      const hit = await caches.match(key);
      if (hit) return hit;
    }
    return res;
  } catch {
    return (await caches.match(key)) || (await caches.match("/offline.html")) || Response.error();
  }
}

// Pages marked private or no-store may hold one person's data. Never keep a copy.
function cacheable(res) {
  return !/no-store|private/i.test(res.headers.get("cache-control") || "");
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const copy = res.clone();
    caches.open(STATIC).then((c) => c.put(req, copy));
  }
  return res;
}
