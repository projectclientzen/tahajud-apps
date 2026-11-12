import { describe, expect, it } from "vitest";
import { ApiError } from "@/data/contracts";
import { originAllowed } from "@/server/api/http";
import { loadAuthConfig } from "@/server/auth/config";
import { parseSessionCookie, sessionCookie, clearSessionCookie } from "@/server/auth/cookie";
import { createSupabaseProvider } from "@/server/auth/providers";
import { DbConfigError, mapDbError, resolveDriver, type Db } from "@/server/db";

const UUID = "11111111-2222-4333-8444-555555555555";
const SECRET = "A".repeat(43);

describe("configuration fails closed", () => {
  it("needs DATABASE_URL, and never reads a default", () => {
    expect(() => resolveDriver({})).toThrow(DbConfigError);
    expect(resolveDriver({ DATABASE_URL: "postgres://x" })).toBe("pg");
  });

  it("PGlite needs an explicit opt-in so it cannot become the production database by accident", () => {
    expect(() => resolveDriver({ DB_DRIVER: "pglite" })).toThrow(/tests only/);
    expect(resolveDriver({ DB_DRIVER: "pglite", TAHAJUD_ALLOW_TEST_DB: "true" })).toBe("pglite");
  });

  it("supabase auth needs its URL, key and a pepper of 32+ characters", () => {
    expect(() => loadAuthConfig({})).toThrow(/SUPABASE_URL/);
    expect(() => loadAuthConfig({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "k" })).toThrow(
      /SESSION_PEPPER/,
    );
    expect(() =>
      loadAuthConfig({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "k", SESSION_PEPPER: "short" }),
    ).toThrow(/32/);
    const ok = loadAuthConfig({
      SUPABASE_URL: "https://x.supabase.co/",
      SUPABASE_ANON_KEY: "k",
      SESSION_PEPPER: "p".repeat(32),
      APP_ORIGINS: "https://a.test, https://b.test",
    });
    expect(ok).toMatchObject({
      provider: "supabase",
      supabaseUrl: "https://x.supabase.co",
      allowedOrigins: ["https://a.test", "https://b.test"],
      mailDir: null,
    });
  });

  it("the local provider needs all three test flags and never runs on a real database", () => {
    expect(() => loadAuthConfig({ AUTH_PROVIDER: "local" })).toThrow(/tests only/);
    expect(() =>
      loadAuthConfig({ AUTH_PROVIDER: "local", TAHAJUD_ALLOW_LOCAL_AUTH: "true", DATABASE_URL: "postgres://x" }),
    ).toThrow(/tests only/);
    expect(() => loadAuthConfig({ AUTH_PROVIDER: "nope" })).toThrow(/AUTH_PROVIDER/);
    const ok = loadAuthConfig({
      AUTH_PROVIDER: "local",
      TAHAJUD_ALLOW_LOCAL_AUTH: "true",
      DB_DRIVER: "pglite",
      TAHAJUD_ALLOW_TEST_DB: "true",
    });
    expect(ok.provider).toBe("local");
  });

  it("the error text names the setting, not a value", () => {
    try {
      loadAuthConfig({
        SUPABASE_URL: "https://secret-project.supabase.co",
        SUPABASE_ANON_KEY: "super-secret-key",
        SESSION_PEPPER: "short",
      });
    } catch (e) {
      expect((e as Error).message).not.toContain("super-secret-key");
      expect((e as Error).message).not.toContain("secret-project");
    }
  });
});

describe("database errors become API errors", () => {
  const raise = (message: string, detail?: string) => Object.assign(new Error(message), { code: "P0001", detail });

  it.each([
    "ENTITLEMENT_INACTIVE",
    "SESSION_LOCKED",
    "NOT_FOUND",
    "VALIDATION_ERROR",
    "UNAUTHENTICATED",
    "PENDING_LOGIN_INVALID",
  ])("%s keeps its code", (code) => {
    expect(mapDbError(raise(code))).toMatchObject({ code });
  });

  it("VERSION_CONFLICT carries the server value where the offline sender reads it", () => {
    const e = mapDbError(raise("VERSION_CONFLICT", '{"checked":true,"version":3}'));
    expect(e).toBeInstanceOf(ApiError);
    expect(e!.details).toEqual({ server: { checked: true, version: 3 } });
  });

  it("LOCATION_REQUIRED is a validation error with a reason", () => {
    expect(mapDbError(raise("LOCATION_REQUIRED"))).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { reason: "LOCATION_REQUIRED" },
    });
  });

  it("anything else is not mapped, so it cannot leak", () => {
    expect(mapDbError(new Error('duplicate key value violates unique constraint "x"'))).toBeNull();
    expect(mapDbError(raise("SOMETHING_ELSE"))).toBeNull();
    expect(mapDbError(null)).toBeNull();
  });
});

describe("cookie", () => {
  it("parses only <uuid>.<secret> and ignores other cookies", () => {
    expect(parseSessionCookie(`a=1; tt_session=${UUID}.${SECRET}; b=2`)).toEqual({ deviceId: UUID, secret: SECRET });
    for (const bad of [
      null,
      "",
      "tt_session=",
      "tt_session=abc",
      `tt_session=${UUID}`,
      `tt_session=${UUID}.short`,
      `tt_session=not-uuid.${SECRET}`,
      `tt_session=${UUID}.${SECRET}!!`,
      `x_tt_session=${UUID}.${SECRET}`,
    ]) {
      expect(parseSessionCookie(bad), String(bad)).toBeNull();
    }
  });

  it("sets HttpOnly and SameSite=Lax, Secure on https, and a 30 day lifetime from the expiry", () => {
    const now = new Date("2026-11-12T00:00:00Z");
    const c = sessionCookie(UUID, SECRET, new Date(now.getTime() + 30 * 86_400_000), now, true);
    expect(c).toContain("Max-Age=2592000");
    for (const f of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/"]) expect(c).toContain(f);
    expect(clearSessionCookie(false)).toContain("Max-Age=0");
    expect(clearSessionCookie(false)).not.toContain("Secure");
  });
});

describe("originAllowed", () => {
  const req = (origin: string | null, host = "app.test") =>
    new Request("https://app.test/api/v1/x", { method: "POST", headers: { host, ...(origin ? { origin } : {}) } });
  it("same host passes, everything else fails", () => {
    expect(originAllowed(req("https://app.test"), [])).toBe(true);
    expect(originAllowed(req(null), [])).toBe(false);
    expect(originAllowed(req("https://evil.test"), [])).toBe(false);
    expect(originAllowed(req("https://app.test.evil.test"), [])).toBe(false);
    expect(originAllowed(req("null"), [])).toBe(false);
    expect(originAllowed(req("https://evil.test"), ["https://evil.test"])).toBe(true);
  });
  it("follows the forwarded host behind a proxy", () => {
    const r = new Request("http://10.0.0.1/api/v1/x", {
      method: "POST",
      headers: { origin: "https://app.test", "x-forwarded-host": "app.test" },
    });
    expect(originAllowed(r, [])).toBe(true);
  });
});

describe("Supabase provider (UNVERIFIED against a real project: request shape only)", () => {
  const cfg = loadAuthConfig({
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SESSION_PEPPER: "p".repeat(32),
  });
  const limits: string[] = [];
  const db = {
    asService: async (fn: (q: { query: (sql: string, p?: unknown[]) => Promise<unknown[]> }) => unknown) =>
      fn({
        query: async (_sql, p) => {
          limits.push(String(p?.[0]));
          return [{ r: { allowed: true, retry_after_seconds: 1 } }];
        },
      }),
    asUser: async () => undefined,
    close: async () => undefined,
  } as unknown as Db;

  it("asks GoTrue to send a code and to check it, with the anon key only", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ user: { id: UUID } }), { status: 200 });
    }) as unknown as typeof fetch;
    const p = createSupabaseProvider(db, cfg, fake);
    await p.request("a@b.test", new Date());
    expect(await p.verify("a@b.test", "123456", new Date())).toEqual({ userId: UUID });
    expect(calls[0]!.url).toBe("https://proj.supabase.co/auth/v1/otp");
    expect(calls[1]!.url).toBe("https://proj.supabase.co/auth/v1/verify");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ type: "email", email: "a@b.test", token: "123456" });
    expect((calls[0]!.init.headers as Record<string, string>).apikey).toBe("anon-key");
    // the limits we add live in rate_limits under hashed keys
    expect(limits.every((k) => !k.includes("a@b.test"))).toBe(true);
  });

  it("a GoTrue refusal on send is an outage, not 'unknown email'; a refusal on verify is just a failed code", async () => {
    const fail = (async () => new Response("{}", { status: 422 })) as unknown as typeof fetch;
    const p = createSupabaseProvider(db, cfg, fail);
    await expect(p.request("a@b.test", new Date())).rejects.toMatchObject({ code: "NOT_AVAILABLE" });
    expect(await p.verify("a@b.test", "123456", new Date())).toBeNull();
  });
});
