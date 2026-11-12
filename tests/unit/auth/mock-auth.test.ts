import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  ApiError,
  authSessionSchema,
  deviceLimitResponseSchema,
  deviceSchema,
  requestOtpResponseSchema,
  verifyOtpResponseSchema,
} from "@/data/contracts";
import { createAuthLayer, createMockAuth, AUTH_SCENARIOS, type MockAuthLayer } from "@/data";
import { memoryAuthStorage, idbAuthStorage } from "@/data/mock/auth";
import { DEMO_EMAILS, userIdFor } from "@/data/mock/fixtures/auth";
import { wib } from "../domain/helpers";
import type { VerifyOtpResponse } from "@/data/contracts";

const clock = { now: () => wib("2026-11-12 08:00") };
const make = (scenario: (typeof AUTH_SCENARIOS)[number] = "logged_out", code = 123456): MockAuthLayer =>
  createMockAuth({ scenario, clock, storage: memoryAuthStorage(), randomInt: () => code });

/** Verify and expect a normal sign-in (not the device limit). */
async function signIn(a: MockAuthLayer, email: string, code = "123456", label?: string): Promise<VerifyOtpResponse> {
  const r = await a.verifyOtp(email, code, label);
  if (r.status !== "ok") throw new Error(`expected sign-in, got ${r.status}`);
  return r;
}

async function err(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
    throw e;
  }
  throw new Error("expected ApiError");
}

describe("mock auth: request OTP", () => {
  it("AUTH-06 gives the identical answer for an email with access and one without", async () => {
    const a = make();
    const known = await a.requestOtp(DEMO_EMAILS.active);
    const unknown = await a.requestOtp("stranger@example.test");
    requestOtpResponseSchema.parse(known);
    expect(unknown).toEqual(known);
    expect(known).toMatchObject({ ok: true, resend_after_seconds: 60 });
  });

  it("AUTH-06 refuses the 6th request within an hour with RATE_LIMITED", async () => {
    const a = make();
    for (let i = 0; i < 5; i++) {
      await a.requestOtp(DEMO_EMAILS.active);
      await a.dev.advance(61_000);
    }
    const e = await err(a.requestOtp(DEMO_EMAILS.active));
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.details).toMatchObject({ reason: "hourly_limit" });
    // the same limit applies to an email nobody owns, so the limit leaks nothing
    for (let i = 0; i < 5; i++) {
      await a.requestOtp("ghost@example.test");
      await a.dev.advance(61_000);
    }
    expect((await err(a.requestOtp("ghost@example.test"))).details).toMatchObject({ reason: "hourly_limit" });
  });

  it("makes the user wait 60 seconds before asking again", async () => {
    const a = make();
    await a.requestOtp(DEMO_EMAILS.active);
    const e = await err(a.requestOtp(DEMO_EMAILS.active));
    expect(e).toMatchObject({ code: "RATE_LIMITED", details: { reason: "cooldown", retry_after_seconds: 60 } });
    await a.dev.advance(60_000);
    await expect(a.requestOtp(DEMO_EMAILS.active)).resolves.toMatchObject({ ok: true });
  });

  it("treats Upper.Case and spaces as the same email for the limit", async () => {
    const a = make();
    await a.requestOtp("Demo@Ngajigaes.test ");
    expect((await err(a.requestOtp(DEMO_EMAILS.active))).code).toBe("RATE_LIMITED");
  });

  it("rejects a malformed email as validation, not as a rate limit", async () => {
    expect((await err(make().requestOtp("not-an-email"))).code).toBe("VALIDATION_ERROR");
  });

  it("exposes the code only through dev tools", async () => {
    const a = make();
    await a.requestOtp(DEMO_EMAILS.active);
    expect(await a.dev.peekOtp(DEMO_EMAILS.active)).toBe("123456");
    expect(await a.dev.peekOtp("nobody@example.test")).toBeNull();
    expect((await a.dev.outbox())[0]).toMatchObject({ to: DEMO_EMAILS.active, code: "123456" });
  });
});

describe("mock auth: verify OTP", () => {
  it("signs in with the right code and returns access", async () => {
    const a = make();
    await a.requestOtp(DEMO_EMAILS.active);
    const r = await signIn(a, DEMO_EMAILS.active, "123456", "Chrome Android");
    verifyOtpResponseSchema.parse({ ...r, status: undefined });
    expect(r.user).toEqual({ id: userIdFor(DEMO_EMAILS.active), email: DEMO_EMAILS.active });
    expect(r.access).toMatchObject({
      access_status: "active",
      entitlement_type: "lifetime",
      authenticated: true,
      onboarding_completed: false,
    });
    const s = authSessionSchema.parse(await a.getSession());
    expect(s).toMatchObject({ authenticated: true, reason: null, device_id: r.device_id });
  });

  it("uses one generic error for wrong, expired, reused, and malformed codes", async () => {
    const a = make();
    await a.requestOtp(DEMO_EMAILS.active);
    const wrong = await err(a.verifyOtp(DEMO_EMAILS.active, "000000"));
    expect(wrong).toMatchObject({ code: "INVALID_OTP", message: "Kode tidak valid atau sudah kedaluwarsa." });
    expect((await err(a.verifyOtp(DEMO_EMAILS.active, "12ab"))).message).toBe(wrong.message);
    expect((await err(a.verifyOtp("nobody@example.test", "123456"))).message).toBe(wrong.message);
    await a.dev.advance(10 * 60_000 + 1000);
    expect((await err(a.verifyOtp(DEMO_EMAILS.active, "123456"))).message).toBe(wrong.message);
  });

  it("locks the code after 5 wrong tries, then even the right code fails", async () => {
    const a = make();
    await a.requestOtp(DEMO_EMAILS.active);
    for (let i = 0; i < 5; i++) await err(a.verifyOtp(DEMO_EMAILS.active, "000000"));
    expect((await err(a.verifyOtp(DEMO_EMAILS.active, "123456"))).code).toBe("INVALID_OTP");
    expect((await a.getSession()).authenticated).toBe(false);
    // asking for a new code starts fresh
    await a.dev.advance(61_000);
    await a.requestOtp(DEMO_EMAILS.active);
    await expect(a.verifyOtp(DEMO_EMAILS.active, "123456")).resolves.toBeTruthy();
  });

  it("a code works once", async () => {
    const a = make();
    await a.requestOtp(DEMO_EMAILS.active);
    await a.verifyOtp(DEMO_EMAILS.active, "123456");
    expect((await err(a.verifyOtp(DEMO_EMAILS.active, "123456"))).code).toBe("INVALID_OTP");
  });

  it("maps entitlements to access states: pending, none, suspended", async () => {
    for (const [email, status] of [
      [DEMO_EMAILS.pending, "awaiting_order_verification"],
      [DEMO_EMAILS.noAccess, "none"],
      [DEMO_EMAILS.suspended, "suspended"],
      ["someone.else@example.test", "none"],
    ] as const) {
      const a = make();
      await a.requestOtp(email);
      expect((await signIn(a, email)).access).toMatchObject({
        access_status: status,
        entitlement_type: null,
      });
    }
    const a = make();
    await a.dev.setEntitlement("Late.Buyer@Example.test", "active");
    await a.requestOtp("late.buyer@example.test");
    expect((await signIn(a, "late.buyer@example.test")).access.access_status).toBe("active");
  });

  it("asks the app whether onboarding is done", async () => {
    const a = createMockAuth({
      clock,
      storage: memoryAuthStorage(),
      randomInt: () => 1,
      onboardingCompleted: async () => true,
    });
    await a.requestOtp(DEMO_EMAILS.active);
    expect((await signIn(a, DEMO_EMAILS.active, "000001")).access.onboarding_completed).toBe(true);
  });
});

describe("mock auth: sessions and devices", () => {
  it.each([
    ["logged_out", { authenticated: false, reason: "none" }],
    ["logged_in", { authenticated: true, reason: null }],
    ["purchase_pending", { authenticated: true, reason: null }],
    ["no_active_access", { authenticated: true, reason: null }],
    ["session_expired", { authenticated: false, reason: "expired" }],
    ["device_limit", { authenticated: false, reason: "none" }],
  ] as const)("scenario %s", async (name, expected) => {
    const s = authSessionSchema.parse(await make(name).getSession());
    expect(s).toMatchObject(expected);
  });

  it("session expires after 30 days (provisional)", async () => {
    const a = make();
    await a.requestOtp(DEMO_EMAILS.active);
    await signIn(a, DEMO_EMAILS.active);
    await a.dev.advance(29 * 86_400_000);
    expect((await a.getSession()).authenticated).toBe(true);
    await a.dev.advance(2 * 86_400_000);
    expect(await a.getSession()).toMatchObject({ authenticated: false, reason: "expired" });
  });

  it("logout ends the session and marks this device signed out", async () => {
    const a = make("logged_in");
    await a.logout();
    expect(await a.getSession()).toMatchObject({ authenticated: false, reason: "none" });
    expect((await err(a.listDevices())).code).toBe("UNAUTHENTICATED");
    await a.logout(); // twice is fine
  });

  it("lists active devices, flags the current one, and revokes another", async () => {
    const a = make("logged_in");
    const list = await a.listDevices();
    list.forEach((d) => deviceSchema.parse(d));
    expect(list.map((d) => [d.id, d.is_current])).toEqual([
      ["dev_current", true],
      ["dev_other_1", false],
      ["dev_other_2", false],
    ]);
    await a.revokeDevice("dev_other_1");
    expect((await a.listDevices()).map((d) => d.id)).toEqual(["dev_current", "dev_other_2"]);
    expect((await err(a.revokeDevice("dev_other_1"))).code).toBe("NOT_FOUND");
    expect((await err(a.revokeDevice("dev_current"))).code).toBe("VALIDATION_ERROR");
  });

  it("AUTH-DEVICE: a 4th login after a right code is refused with the device list and a pending token", async () => {
    const a = make("device_limit"); // signed out, 3 active devices for the demo user
    await a.requestOtp(DEMO_EMAILS.active);
    const r = await a.verifyOtp(DEMO_EMAILS.active, "123456", "Tablet baru");
    expect(r.status).toBe("device_limit");
    if (r.status !== "device_limit") return;
    deviceLimitResponseSchema.parse(r);
    expect(r.max_devices).toBe(3);
    expect(r.devices).toHaveLength(3);
    expect(r.devices.every((d) => !d.is_current)).toBe(true);
    // No session was created and nothing was signed out by itself.
    expect(await a.getSession()).toMatchObject({ authenticated: false });
  });

  it("AUTH-DEVICE: removing one device lets the login continue, and the token works once", async () => {
    const a = make("device_limit");
    await a.requestOtp(DEMO_EMAILS.active);
    const r = await a.verifyOtp(DEMO_EMAILS.active, "123456");
    if (r.status !== "device_limit") throw new Error("expected device_limit");
    const done = await a.completePendingLogin(r.pending_token, "dev_old_2", "Tablet baru");
    verifyOtpResponseSchema.parse(done);
    const ids = (await a.listDevices()).map((d) => d.id);
    expect(ids).toHaveLength(3);
    expect(ids).toContain(done.device_id);
    expect(ids).not.toContain("dev_old_2"); // the one the user chose, not the oldest
    expect(ids).toContain("dev_old_3");
    expect((await err(a.completePendingLogin(r.pending_token, "dev_old_1"))).code).toBe("PENDING_LOGIN_INVALID");
  });

  it("AUTH-DEVICE: the pending token expires after 10 minutes and a wrong device id does not burn it", async () => {
    const a = make("device_limit");
    await a.requestOtp(DEMO_EMAILS.active);
    const r = await a.verifyOtp(DEMO_EMAILS.active, "123456");
    if (r.status !== "device_limit") throw new Error("expected device_limit");
    expect((await err(a.completePendingLogin(r.pending_token, "dev_nope"))).code).toBe("NOT_FOUND");
    await a.dev.advance(10 * 60_000 + 1000);
    expect((await err(a.completePendingLogin(r.pending_token, "dev_old_1"))).code).toBe("PENDING_LOGIN_INVALID");
    expect((await err(a.completePendingLogin("pl_made_up", "dev_old_1"))).code).toBe("PENDING_LOGIN_INVALID");
  });

  it("a wrong code never reveals the device list", async () => {
    const a = make("device_limit");
    await a.requestOtp(DEMO_EMAILS.active);
    expect((await err(a.verifyOtp(DEMO_EMAILS.active, "000000"))).code).toBe("INVALID_OTP");
  });

  it("reports a revoked current device as signed out with reason 'revoked'", async () => {
    const a = make("logged_in");
    const st = a.engine as unknown as {
      state: { devices: Record<string, { id: string; revokedAt: number | null }[]> };
    };
    await a.getSession();
    st.state.devices[userIdFor(DEMO_EMAILS.active)]!.find((d) => d.id === "dev_current")!.revokedAt = 1;
    expect(await a.getSession()).toMatchObject({ authenticated: false, reason: "revoked" });
  });

  it("dev tools: scenario switch keeps the clock; reset returns to the starting scenario", async () => {
    const a = make("logged_in");
    await a.dev.setNow(wib("2026-12-24 08:00").toISOString());
    await a.dev.loadScenario("session_expired");
    expect((await a.getSession()).reason).toBe("expired");
    await a.dev.reset();
    expect((await a.getSession()).authenticated).toBe(true); // started as logged_in
  });
});

describe("auth layer selection", () => {
  it("live mode talks to /api/v1: with no server in reach it reports OFFLINE, never a fake answer (T3b)", async () => {
    const live = createAuthLayer({ mode: "live" });
    expect(live).not.toHaveProperty("dev");
    expect((await err(live.requestOtp("a@b.id"))).code).toBe("OFFLINE");
  });
  it("mock mode returns the mock", () =>
    expect(createAuthLayer({ mode: "mock", storage: memoryAuthStorage() })).toHaveProperty("dev"));
  it("lists every auth scenario", () => expect(AUTH_SCENARIOS).toHaveLength(6));
});

describe("auth persistence in IndexedDB", () => {
  it("survives a new instance", async () => {
    const mk = () => createMockAuth({ clock, storage: idbAuthStorage(), randomInt: () => 123456 });
    const a = mk();
    await a.dev.reset();
    await a.requestOtp(DEMO_EMAILS.active);
    const b = mk();
    expect((await err(b.requestOtp(DEMO_EMAILS.active))).code).toBe("RATE_LIMITED"); // cooldown remembered
    await b.verifyOtp(DEMO_EMAILS.active, "123456");
    expect((await mk().getSession()).authenticated).toBe(true);
    await mk().dev.reset();
  });
});
