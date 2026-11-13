import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  ApiError,
  authSessionSchema,
  deviceLimitResponseSchema,
  deviceSchema,
  signInResponseSchema,
  type SignInResponse,
} from "@/data/contracts";
import { createAuthLayer, createMockAuth, AUTH_SCENARIOS, type MockAuthLayer } from "@/data";
import { memoryAuthStorage, idbAuthStorage } from "@/data/mock/auth";
import { DEMO_EMAILS, DEMO_PASSWORD, DEMO_PHONES, userIdFor } from "@/data/mock/fixtures/auth";
import { wib } from "../domain/helpers";

const clock = { now: () => wib("2026-11-12 08:00") };
const make = (scenario: (typeof AUTH_SCENARIOS)[number] = "logged_out"): MockAuthLayer =>
  createMockAuth({ scenario, clock, storage: memoryAuthStorage(), randomInt: () => 123456 });

/** Log in and expect a normal sign-in (not the device limit). */
async function signIn(a: MockAuthLayer, email: string, password = DEMO_PASSWORD, label?: string): Promise<SignInResponse> {
  const r = await a.login(email, password, label);
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

const NEW_PW = "kata-sandi-baru-yang-panjang";

describe("mock auth: login (DEMO data, demo password)", () => {
  it("signs in with the demo password and returns access", async () => {
    const a = make();
    const r = await signIn(a, DEMO_EMAILS.active, DEMO_PASSWORD, "Chrome Android");
    signInResponseSchema.parse({ ...r, status: undefined });
    expect(r.user).toEqual({ id: userIdFor(DEMO_EMAILS.active), email: DEMO_EMAILS.active });
    expect(r.access).toMatchObject({
      access_status: "active",
      entitlement_type: "lifetime",
      authenticated: true,
      onboarding_completed: false,
    });
    expect(authSessionSchema.parse(await a.getSession())).toMatchObject({
      authenticated: true,
      reason: null,
      device_id: r.device_id,
    });
  });

  it("treats Upper.Case and spaces in the email as the same account", async () => {
    expect((await signIn(make(), " Demo@Ngajigaes.test ")).user.email).toBe(DEMO_EMAILS.active);
  });

  it("uses one generic error for a wrong password, an unknown email and a bad shape", async () => {
    const a = make();
    const wrong = await err(a.login(DEMO_EMAILS.active, "salah-salah-1"));
    expect(wrong).toMatchObject({ code: "INVALID_CREDENTIALS", message: "Email atau password salah." });
    expect((await err(a.login("nobody@example.test", DEMO_PASSWORD))).message).toBe(wrong.message);
    expect((await err(a.login("not-an-email", DEMO_PASSWORD))).message).toBe(wrong.message);
    expect((await err(a.login(DEMO_EMAILS.newBuyer, DEMO_PASSWORD))).message).toBe(wrong.message); // paid, but no account yet
    expect((await a.getSession()).authenticated).toBe(false);
  });

  it("locks an email after 10 failures in 15 minutes, a right password does not bypass it, then it frees", async () => {
    const a = make();
    for (let i = 0; i < 10; i++) await err(a.login(DEMO_EMAILS.active, "salah-salah-1"));
    expect((await err(a.login(DEMO_EMAILS.active, DEMO_PASSWORD))).code).toBe("RATE_LIMITED");
    await a.dev.advance(15 * 60_000 + 1000);
    await expect(a.login(DEMO_EMAILS.active, DEMO_PASSWORD)).resolves.toMatchObject({ status: "ok" });
  });

  it("successful logins do not count toward the limit", async () => {
    const a = make();
    for (let i = 0; i < 12; i++) await a.login(DEMO_EMAILS.active, DEMO_PASSWORD, `P${i}`);
  });

  it("maps entitlements to access states: pending, none, suspended", async () => {
    for (const [email, status] of [
      [DEMO_EMAILS.pending, "awaiting_order_verification"],
      [DEMO_EMAILS.noAccess, "none"],
      [DEMO_EMAILS.suspended, "suspended"],
    ] as const) {
      expect((await signIn(make(), email)).access).toMatchObject({ access_status: status, entitlement_type: null });
    }
  });

  it("asks the app whether onboarding is done", async () => {
    const a = createMockAuth({ clock, storage: memoryAuthStorage(), onboardingCompleted: async () => true });
    expect((await signIn(a, DEMO_EMAILS.active)).access.onboarding_completed).toBe(true);
  });
});

describe("mock auth: activation (DEMO order, demo phone)", () => {
  const act = (a: MockAuthLayer, email: string, phone: string, password = NEW_PW) =>
    a.activate({ email, phone, password, deviceLabel: "HP baru" });

  it("creates the account from the demo order and signs in", async () => {
    const a = make();
    const r = await act(a, DEMO_EMAILS.newBuyer, DEMO_PHONES.newBuyer);
    expect(r).toMatchObject({ status: "ok", user: { email: DEMO_EMAILS.newBuyer }, access: { access_status: "active" } });
    expect((await a.getSession()).authenticated).toBe(true);
    // the chosen password now works from a new device (a second instance sharing nothing but the same state)
    await a.logout();
    expect(await signIn(a, DEMO_EMAILS.newBuyer, NEW_PW)).toMatchObject({ user: { email: DEMO_EMAILS.newBuyer } });
  });

  it("accepts the phone in any common form", async () => {
    for (const phone of ["081200000002", "+62 812-0000-0002", "6281200000002", "0812 0000 0002"]) {
      expect((await act(make(), DEMO_EMAILS.newBuyer, phone)).status).toBe("ok");
    }
  });

  it("every failure is one ACTIVATION_FAILED answer", async () => {
    const answers = new Set<string>();
    for (const [email, phone] of [
      ["nobody@example.test", DEMO_PHONES.newBuyer],
      [DEMO_EMAILS.newBuyer, "081299999999"],
      [DEMO_EMAILS.newBuyer, "bukan nomor"],
      [DEMO_EMAILS.active, DEMO_PHONES.active], // already has an account
      [DEMO_EMAILS.pending, DEMO_PHONES.active],
    ] as const) {
      const e = await err(act(make(), email, phone));
      expect(e.code).toBe("ACTIVATION_FAILED");
      answers.add(e.message);
    }
    expect(answers.size).toBe(1);
  });

  it("works once: a second activation is refused", async () => {
    const a = make();
    await act(a, DEMO_EMAILS.newBuyer, DEMO_PHONES.newBuyer);
    expect((await err(act(a, DEMO_EMAILS.newBuyer, DEMO_PHONES.newBuyer, "sandi-lain-yang-panjang"))).code).toBe(
      "ACTIVATION_FAILED",
    );
  });

  it("a weak password is refused with the reason and creates nothing", async () => {
    const a = make();
    const e = await err(act(a, DEMO_EMAILS.newBuyer, DEMO_PHONES.newBuyer, "pendek"));
    expect(e).toMatchObject({ code: "WEAK_PASSWORD", details: { reason: "too_short" } });
    expect((await err(a.login(DEMO_EMAILS.newBuyer, "pendek"))).code).toBe("INVALID_CREDENTIALS");
    expect((await act(a, DEMO_EMAILS.newBuyer, DEMO_PHONES.newBuyer)).status).toBe("ok");
  });

  it("5 failures per email lock it, and 429 does not say which counter ran out", async () => {
    const a = make();
    for (let i = 0; i < 5; i++) await err(act(a, DEMO_EMAILS.newBuyer, `08120000009${i}`));
    const e = await err(act(a, DEMO_EMAILS.newBuyer, DEMO_PHONES.newBuyer));
    expect(e).toMatchObject({ code: "RATE_LIMITED" });
    expect(JSON.stringify(e.details)).not.toMatch(/email|phone|ip/i);
  });

  it("respects the entitlement: a demo order that is not active cannot activate", async () => {
    const a = make();
    await a.dev.setEntitlement(DEMO_EMAILS.newBuyer, "none");
    expect((await err(act(a, DEMO_EMAILS.newBuyer, DEMO_PHONES.newBuyer))).code).toBe("ACTIVATION_FAILED");
  });
});

describe("mock auth: reset, admin link and change password", () => {
  it("self reset needs email + phone, signs every device out and opens no session", async () => {
    const a = make("logged_in");
    await a.resetPassword({ email: DEMO_EMAILS.active, phone: DEMO_PHONES.active, newPassword: NEW_PW });
    expect(await a.getSession()).toMatchObject({ authenticated: false, reason: "revoked" });
    expect((await err(a.login(DEMO_EMAILS.active, DEMO_PASSWORD))).code).toBe("INVALID_CREDENTIALS");
    expect((await signIn(a, DEMO_EMAILS.active, NEW_PW)).user.email).toBe(DEMO_EMAILS.active);
  });

  it("self reset is refused for a wrong phone, a missing account and an account without an order", async () => {
    const a = make();
    for (const [email, phone] of [
      [DEMO_EMAILS.active, "081299999999"],
      ["nobody@example.test", DEMO_PHONES.active],
      [DEMO_EMAILS.pending, DEMO_PHONES.active],
    ] as const) {
      expect((await err(a.resetPassword({ email, phone, newPassword: NEW_PW }))).code).toBe("ACTIVATION_FAILED");
    }
    expect((await signIn(a, DEMO_EMAILS.active)).user.email).toBe(DEMO_EMAILS.active); // password unchanged
  });

  it("an admin link works once, expires, and signs in", async () => {
    const a = make();
    const token = (await a.dev.issueResetToken(DEMO_EMAILS.active))!;
    const r = await a.setPasswordWithToken(token, NEW_PW, "HP CS");
    expect(r).toMatchObject({ status: "ok", user: { email: DEMO_EMAILS.active } });
    expect((await err(a.setPasswordWithToken(token, "sandi-lain-yang-panjang"))).code).toBe("INVALID_TOKEN");
    const t2 = (await a.dev.issueResetToken(DEMO_EMAILS.active))!;
    await a.dev.advance(61 * 60_000);
    expect((await err(a.setPasswordWithToken(t2, NEW_PW))).code).toBe("INVALID_TOKEN");
    expect((await err(a.setPasswordWithToken("made-up", NEW_PW))).code).toBe("INVALID_TOKEN");
    expect(await a.dev.issueResetToken("nobody@example.test")).toBeNull();
  });

  it("a newer admin link revokes the older one", async () => {
    const a = make();
    const t1 = (await a.dev.issueResetToken(DEMO_EMAILS.active))!;
    const t2 = (await a.dev.issueResetToken(DEMO_EMAILS.active))!;
    expect((await err(a.setPasswordWithToken(t1, NEW_PW))).code).toBe("INVALID_TOKEN");
    expect((await a.setPasswordWithToken(t2, NEW_PW)).status).toBe("ok");
  });

  it("change password needs the current one, keeps this device and signs the others out", async () => {
    const a = make("logged_in");
    expect((await err(a.changePassword("salah-salah-1", NEW_PW))).code).toBe("INVALID_CREDENTIALS");
    await a.changePassword(DEMO_PASSWORD, NEW_PW);
    expect((await a.getSession()).authenticated).toBe(true);
    expect((await a.listDevices()).map((d) => d.id)).toEqual(["dev_current"]);
    expect((await err(a.changePassword(NEW_PW, "pendek"))).code).toBe("WEAK_PASSWORD");
  });

  it("change password needs a session", async () => {
    expect((await err(make().changePassword(DEMO_PASSWORD, NEW_PW))).code).toBe("UNAUTHENTICATED");
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
    expect(authSessionSchema.parse(await make(name).getSession())).toMatchObject(expected);
  });

  it("session expires after 30 days (provisional)", async () => {
    const a = make();
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

  it("AUTH-14: a 4th login after a right password is refused with the device list and a pending token", async () => {
    const a = make("device_limit"); // signed out, 3 active devices for the demo user
    const r = await a.login(DEMO_EMAILS.active, DEMO_PASSWORD, "Tablet baru");
    expect(r.status).toBe("device_limit");
    if (r.status !== "device_limit") return;
    deviceLimitResponseSchema.parse(r);
    expect(r.max_devices).toBe(3);
    expect(r.devices).toHaveLength(3);
    expect(r.devices.every((d) => !d.is_current)).toBe(true);
    // No session was created and nothing was signed out by itself.
    expect(await a.getSession()).toMatchObject({ authenticated: false });
  });

  it("AUTH-14: removing one device lets the login continue, and the token works once", async () => {
    const a = make("device_limit");
    const r = await a.login(DEMO_EMAILS.active, DEMO_PASSWORD);
    if (r.status !== "device_limit") throw new Error("expected device_limit");
    const done = await a.completePendingLogin(r.pending_token, "dev_old_2", "Tablet baru");
    signInResponseSchema.parse(done);
    const ids = (await a.listDevices()).map((d) => d.id);
    expect(ids).toHaveLength(3);
    expect(ids).toContain(done.device_id);
    expect(ids).not.toContain("dev_old_2"); // the one the user chose, not the oldest
    expect(ids).toContain("dev_old_3");
    expect((await err(a.completePendingLogin(r.pending_token, "dev_old_1"))).code).toBe("PENDING_LOGIN_INVALID");
  });

  it("AUTH-14: the pending token expires after 10 minutes and a wrong device id does not burn it", async () => {
    const a = make("device_limit");
    const r = await a.login(DEMO_EMAILS.active, DEMO_PASSWORD);
    if (r.status !== "device_limit") throw new Error("expected device_limit");
    expect((await err(a.completePendingLogin(r.pending_token, "dev_nope"))).code).toBe("NOT_FOUND");
    await a.dev.advance(10 * 60_000 + 1000);
    expect((await err(a.completePendingLogin(r.pending_token, "dev_old_1"))).code).toBe("PENDING_LOGIN_INVALID");
    expect((await err(a.completePendingLogin("pl_made_up", "dev_old_1"))).code).toBe("PENDING_LOGIN_INVALID");
  });

  it("a wrong password never reveals the device list", async () => {
    const a = make("device_limit");
    expect((await err(a.login(DEMO_EMAILS.active, "salah-salah-1"))).code).toBe("INVALID_CREDENTIALS");
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
    expect((await err(live.login("a@b.id", "apa-saja-1234"))).code).toBe("OFFLINE");
  });
  it("mock mode returns the mock", () =>
    expect(createAuthLayer({ mode: "mock", storage: memoryAuthStorage() })).toHaveProperty("dev"));
  it("lists every auth scenario", () => expect(AUTH_SCENARIOS).toHaveLength(6));
});

describe("auth persistence in IndexedDB", () => {
  it("survives a new instance (accounts made by activation are remembered)", async () => {
    const mk = () => createMockAuth({ clock, storage: idbAuthStorage() });
    const a = mk();
    await a.dev.reset();
    await a.activate({ email: DEMO_EMAILS.newBuyer, phone: DEMO_PHONES.newBuyer, password: NEW_PW });
    const b = mk();
    expect((await b.getSession()).authenticated).toBe(true);
    await b.logout();
    expect((await mk().login(DEMO_EMAILS.newBuyer, NEW_PW)).status).toBe("ok");
    await mk().dev.reset();
  });

  it("saved state from the OTP version is dropped, not misread", async () => {
    const storage = memoryAuthStorage();
    await storage.save({ schemaVersion: 1, scenario: "logged_in", otps: {}, session: { userId: "u_old" } } as never);
    const a = createMockAuth({ clock, storage });
    expect(await a.getSession()).toMatchObject({ authenticated: false, reason: "none" });
    expect((await a.login(DEMO_EMAILS.active, DEMO_PASSWORD)).status).toBe("ok");
  });
});
