import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { createHttpAuthRepository, createHttpDataLayer } from "@/data/http";
import type { AuthConfig } from "@/server/auth/config";
import { setDepsForTests } from "@/server/api/deps";
import { setDbForTests } from "@/server/db";
import { createPgliteDb, type PgliteDb } from "@/server/db/pglite";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
interface Route {
  segs: string[];
  methods: Record<string, Handler>;
  score: number;
}

// The real route files, found the way Next finds them. Nothing is mocked between the request and the database.
const ROUTE_ROOT = join(process.cwd(), "src", "app", "api", "v1");
function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? routeFiles(join(dir, e.name)) : e.name === "route.ts" ? [join(dir, e.name)] : [],
  );
}
let routes: Route[] | null = null;
async function loadRoutes(): Promise<Route[]> {
  routes ??= await Promise.all(
    routeFiles(ROUTE_ROOT).map(async (file) => {
      const mod = (await import(/* @vite-ignore */ file)) as Record<string, Handler>;
      const rel = relative(ROUTE_ROOT, dirname(file));
      const segs = rel === "" ? [] : rel.split(sep);
      return { segs, methods: mod, score: segs.filter((s) => !s.startsWith("[")).length };
    }),
  );
  return routes;
}

function match(routes: Route[], pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname
    .replace(/^\/api\/v1\/?/, "")
    .split("/")
    .filter(Boolean);
  let best: { route: Route; params: Record<string, string> } | null = null;
  for (const r of routes) {
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < r.segs.length; i++) {
      const s = r.segs[i]!;
      if (s.startsWith("[...")) break; // catch-all takes the rest
      if (parts[i] === undefined) ok = false;
      else if (s.startsWith("[")) params[s.slice(1, -1)] = decodeURIComponent(parts[i]!);
      else if (s !== parts[i]) ok = false;
      if (!ok) break;
    }
    const catchAll = r.segs.at(-1)?.startsWith("[...") ?? false;
    if (ok && !catchAll && parts.length !== r.segs.length) ok = false;
    if (ok && (!best || r.score > best.route.score)) best = { route: r, params };
  }
  return best;
}

export const ORIGIN = "http://localhost:3100";

export async function dispatch(req: Request): Promise<Response> {
  const m = match(await loadRoutes(), new URL(req.url).pathname);
  const handler = m?.route.methods[req.method];
  if (!m || !handler) return new Response("no route", { status: m ? 405 : 404 });
  return handler(req, { params: Promise.resolve(m.params) });
}

/** A browser: keeps cookies, sends Origin on mutations, and has an IP. */
export class TestBrowser {
  readonly jar = new Map<string, string>();
  constructor(
    public readonly ip = "203.0.113.10",
    public readonly origin = ORIGIN,
  ) {}

  fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url,
      this.origin,
    );
    const headers = new Headers(init.headers);
    const method = (init.method ?? "GET").toUpperCase();
    if (this.jar.size) headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    if (method !== "GET" && method !== "HEAD" && !headers.has("origin")) headers.set("origin", this.origin);
    if (!headers.has("x-forwarded-for")) headers.set("x-forwarded-for", this.ip);
    const res = await dispatch(new Request(url, { ...init, method, headers }));
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";").map((x) => x.trim());
      const [name, ...value] = pair!.split("=");
      if (attrs.some((a) => a.toLowerCase() === "max-age=0")) this.jar.delete(name!);
      else this.jar.set(name!, value.join("="));
    }
    return res;
  };

  /** Raw request with full control over headers. Cookies are still sent. */
  raw(path: string, init: RequestInit = {}): Promise<Response> {
    return this.fetch(`/api/v1${path}`, init);
  }
  json(path: string, method: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return this.raw(path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  get cookieValue(): string | undefined {
    return this.jar.get("tt_session");
  }
  setCookie(v: string): void {
    this.jar.set("tt_session", v);
  }
  auth() {
    return createHttpAuthRepository({ fetch: this.fetch });
  }
  data() {
    return createHttpDataLayer({ fetch: this.fetch });
  }
}

export interface ApiEnv {
  db: PgliteDb;
  cfg: AuthConfig;
  mailDir: string;
  /** Moves the app clock and the database clock together. */
  setNow(iso: string): Promise<void>;
  now(): Date;
  browser(ip?: string): TestBrowser;
  /** Code the local provider "emailed" to this address. */
  readCode(email: string): string;
  grant(email: string, status?: "active" | "pending_verification" | "suspended" | "revoked" | "expired"): Promise<void>;
  /** Sign in a fresh browser through the real endpoints (code from the mail file). */
  signIn(email: string, opts?: { browser?: TestBrowser; label?: string }): Promise<TestBrowser>;
  /** Sign in, choose the demo Jakarta region, and finish onboarding. */
  onboarded(email: string, opts?: { browser?: TestBrowser }): Promise<TestBrowser>;
  userId(email: string): Promise<string>;
  close(): Promise<void>;
}

export async function createApiEnv(startAt = "2026-11-12T02:00:00+07:00"): Promise<ApiEnv> {
  const db = await createPgliteDb();
  const mailDir = mkdtempSync(join(tmpdir(), "tt-mail-"));
  const cfg: AuthConfig = {
    provider: "local",
    pepper: "test-pepper-test-pepper-test-pepper-123",
    allowedOrigins: [],
    mailDir,
    supabaseUrl: null,
    supabaseAnonKey: null,
  };
  let nowMs = Date.parse(startAt);
  await db.setNow(new Date(nowMs).toISOString());
  setDbForTests(db);
  setDepsForTests({ now: () => new Date(nowMs), cfg });
  // Prayer times for the demo Jakarta region: Fajr 04:30 WIB for two weeks.
  await db.exec(`
    insert into public.prayer_times (region_id, local_date, fajr_at, maghrib_at, provider, fetched_at, valid_until)
    select r.id, d::date, ((d::date + time '04:30')::timestamp at time zone 'Asia/Jakarta'),
           ((d::date + time '17:55')::timestamp at time zone 'Asia/Jakarta'), 'test', '2026-11-01T00:00:00Z', '2027-01-01T00:00:00Z'
    from public.regions r, generate_series('2026-11-01'::date, '2027-03-01'::date, interval '1 day') d
    where r.provider_region_code = 'DEMO-JKT'`);

  let ipN = 10;
  const env: ApiEnv = {
    db,
    cfg,
    mailDir,
    now: () => new Date(nowMs),
    async setNow(iso) {
      nowMs = Date.parse(iso);
      await db.setNow(new Date(nowMs).toISOString());
    },
    browser: (ip) => new TestBrowser(ip ?? `203.0.113.${ipN++}`),
    readCode(email) {
      return (JSON.parse(readFileSync(join(mailDir, `${email}.json`), "utf8")) as { code: string }).code;
    },
    async grant(email, status = "active") {
      await db.exec(
        "insert into public.access_entitlements (email_normalized, status, starts_at, expires_at) values ($1, $2, '2026-01-01T00:00:00Z', null)",
        [email, status],
      );
    },
    async signIn(email, opts = {}) {
      const b = opts.browser ?? env.browser();
      const auth = b.auth();
      // Tests that sign in several times for the same email are not testing the resend limits.
      await db.exec("delete from public.login_otps");
      await db.exec("delete from public.rate_limits");
      await auth.requestOtp(email);
      const r = await auth.verifyOtp(email, env.readCode(email), opts.label ?? "Chrome di Android");
      if (r.status !== "ok") throw new Error("device limit");
      return b;
    },
    async onboarded(email, opts = {}) {
      await env.grant(email);
      const b = await env.signIn(email, opts);
      const layer = b.data();
      const regions = await layer.prayer.listRegions();
      const jkt = regions.find((r) => r.name.startsWith("Jakarta"))!;
      await layer.profile.setLocation({ mode: "region", region_id: jkt.id });
      await layer.profile.completeOnboarding();
      return b;
    },
    async userId(email) {
      return String((await db.exec("select id::text as id from auth.users where email = $1", [email]))[0]!.id);
    },
    async close() {
      setDbForTests(null);
      setDepsForTests();
      await db.close();
      rmSync(mailDir, { recursive: true, force: true });
    },
  };
  return env;
}
