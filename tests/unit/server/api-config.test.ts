import { describe, expect, it } from "vitest";
import { ApiError } from "@/data/contracts";
import { originAllowed } from "@/server/api/http";
import { loadAuthConfig } from "@/server/auth/config";
import { parseSessionCookie, sessionCookie, clearSessionCookie } from "@/server/auth/cookie";
import { DbConfigError, mapDbError, resolveDriver } from "@/server/db";

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

  it("auth needs a pepper of 32+ characters and no longer needs any Supabase setting", () => {
    expect(() => loadAuthConfig({})).toThrow(/SESSION_PEPPER/);
    expect(() => loadAuthConfig({ SESSION_PEPPER: "short" })).toThrow(/32/);
    const ok = loadAuthConfig({ SESSION_PEPPER: "p".repeat(32), APP_ORIGINS: "https://a.test, https://b.test" });
    expect(ok).toMatchObject({ allowedOrigins: ["https://a.test", "https://b.test"], trustedProxyHops: 1 });
    expect(ok.scrypt).toEqual({ ln: 15, r: 8, p: 3 });
  });

  it("the built in test pepper exists only with the PGlite test flags", () => {
    expect(() => loadAuthConfig({ DB_DRIVER: "pglite" })).toThrow(/SESSION_PEPPER/);
    const ok = loadAuthConfig({ DB_DRIVER: "pglite", TAHAJUD_ALLOW_TEST_DB: "true" });
    expect(ok.pepper.length).toBeGreaterThanOrEqual(32);
  });

  it("TRUSTED_PROXY_HOPS is required in production and must be 0 to 5 (AUTH-15)", () => {
    const base = { SESSION_PEPPER: "p".repeat(32) };
    expect(() => loadAuthConfig({ ...base, NODE_ENV: "production" })).toThrow(/TRUSTED_PROXY_HOPS/);
    expect(() => loadAuthConfig({ ...base, TRUSTED_PROXY_HOPS: "9" })).toThrow(/0 to 5/);
    expect(() => loadAuthConfig({ ...base, TRUSTED_PROXY_HOPS: "x" })).toThrow(/0 to 5/);
    expect(loadAuthConfig({ ...base, NODE_ENV: "production", TRUSTED_PROXY_HOPS: "2" }).trustedProxyHops).toBe(2);
    expect(loadAuthConfig({ ...base, TRUSTED_PROXY_HOPS: "0" }).trustedProxyHops).toBe(0);
  });

  it("the phone check of activation cannot be turned off", () => {
    const base = { SESSION_PEPPER: "p".repeat(32) };
    expect(() => loadAuthConfig({ ...base, ACTIVATION_PHONE_REQUIRED: "false" })).toThrow(/cannot be turned off/);
    expect(() => loadAuthConfig({ ...base, ACTIVATION_PHONE_REQUIRED: "true" })).not.toThrow();
  });

  it("the error text names the setting, not a value", () => {
    try {
      loadAuthConfig({ SESSION_PEPPER: "short-secret-value" });
    } catch (e) {
      expect((e as Error).message).not.toContain("short-secret-value");
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
