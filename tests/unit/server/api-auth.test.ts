import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/data/contracts";
import { createApiEnv, ORIGIN, type ApiEnv, type TestBrowser } from "./api-harness";

const MIN = 60_000;
const T0 = "2026-11-12T02:00:00+07:00";
const at = (ms: number) => new Date(Date.parse(T0) + ms).toISOString();

async function code(res: Promise<unknown>): Promise<string | undefined> {
  try {
    await res;
    return undefined;
  } catch (e) {
    return e instanceof ApiError ? e.code : "other";
  }
}

describe("sign-in (PRD §24.1)", () => {
  let env: ApiEnv;
  beforeAll(async () => {
    env = await createApiEnv();
  });
  afterAll(async () => env.close());
  const fresh = async () => {
    await env.setNow(T0);
    return env.browser();
  };

  describe("AUTH-05: the code", () => {
    it("works once and opens a session with an HttpOnly SameSite=Lax cookie", async () => {
      const b = await fresh();
      await env.grant("a1@ngajigaes.test");
      await b.auth().requestOtp("a1@ngajigaes.test");
      const res = await b.json("/auth/verify-otp", "POST", {
        email: "a1@ngajigaes.test",
        code: env.readCode("a1@ngajigaes.test"),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        status: "ok",
        user: { email: "a1@ngajigaes.test" },
        access: { access_status: "active" },
      });
      const cookie = res.headers.get("set-cookie")!;
      expect(cookie).toMatch(/^tt_session=[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,}/);
      for (const flag of ["HttpOnly", "SameSite=Lax", "Path=/"]) expect(cookie).toContain(flag);
      expect(cookie).not.toContain("Secure"); // plain http in tests
      // the secret half of the cookie is never in the body
      expect(JSON.stringify(body)).not.toContain(cookie.split("=")[1]!.split(".")[1]!.split(";")[0]!);
      // the same code does not work again
      const again = await b.json("/auth/verify-otp", "POST", {
        email: "a1@ngajigaes.test",
        code: env.readCode("a1@ngajigaes.test"),
      });
      expect(again.status).toBe(401);
      expect((await again.json()).error.code).toBe("INVALID_OTP");
    });

    it("sets Secure when the request came over https", async () => {
      const b = await fresh();
      await b.auth().requestOtp("a2@ngajigaes.test");
      const res = await b.json(
        "/auth/verify-otp",
        "POST",
        { email: "a2@ngajigaes.test", code: env.readCode("a2@ngajigaes.test") },
        { "x-forwarded-proto": "https" },
      );
      expect(res.headers.get("set-cookie")).toContain("Secure");
    });

    it("a wrong code, an expired code and a code nobody asked for all give the same answer", async () => {
      const b = await fresh();
      await b.auth().requestOtp("a3@ngajigaes.test");
      const good = env.readCode("a3@ngajigaes.test");
      const wrong = good === "000000" ? "000001" : "000000";
      const r1 = await b.json("/auth/verify-otp", "POST", { email: "a3@ngajigaes.test", code: wrong });
      const r2 = await b.json("/auth/verify-otp", "POST", { email: "nobody@ngajigaes.test", code: wrong });
      expect(r1.status).toBe(401);
      expect(await r1.json()).toEqual(await r2.json());
      await env.setNow(at(11 * MIN));
      const r3 = await b.json("/auth/verify-otp", "POST", { email: "a3@ngajigaes.test", code: good });
      expect(r3.status).toBe(401);
      expect((await r3.json()).error.code).toBe("INVALID_OTP");
    });

    it("dies after 5 wrong tries, even if the right code comes next", async () => {
      const b = await fresh();
      await b.auth().requestOtp("a4@ngajigaes.test");
      const good = env.readCode("a4@ngajigaes.test");
      const wrong = good === "111111" ? "222222" : "111111";
      for (let i = 0; i < 5; i++)
        expect(await code(b.auth().verifyOtp("a4@ngajigaes.test", wrong))).toBe("INVALID_OTP");
      expect(await code(b.auth().verifyOtp("a4@ngajigaes.test", good))).toBe("INVALID_OTP");
    });

    it("lasts 10 minutes", async () => {
      const b = await fresh();
      await b.auth().requestOtp("a5@ngajigaes.test");
      await env.setNow(at(9 * MIN + 50_000));
      const r = await b.auth().verifyOtp("a5@ngajigaes.test", env.readCode("a5@ngajigaes.test"));
      expect(r.status).toBe("ok");
    });

    it("refuses a code that is not six digits before it touches anything", async () => {
      const b = await fresh();
      const res = await b.json("/auth/verify-otp", "POST", { email: "a6@ngajigaes.test", code: "12ab56" });
      expect(res.status).toBe(400);
    });
  });

  describe("AUTH-06: limits and the generic answer", () => {
    it("answers the same for an email with access and one without", async () => {
      const b = await fresh();
      await env.grant("known@ngajigaes.test");
      const a = await b.json("/auth/request-otp", "POST", { email: "known@ngajigaes.test" });
      const c = await b.json("/auth/request-otp", "POST", { email: "unknown@ngajigaes.test" });
      expect(a.status).toBe(c.status);
      expect(await a.json()).toEqual(await c.json());
    });

    it("waits 60 seconds before sending another code, and says how long", async () => {
      const b = await fresh();
      await b.auth().requestOtp("l1@ngajigaes.test");
      await env.setNow(at(30_000));
      const res = await b.json("/auth/request-otp", "POST", { email: "l1@ngajigaes.test" });
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("30");
      expect((await res.json()).error).toMatchObject({
        code: "RATE_LIMITED",
        details: { reason: "cooldown", retry_after_seconds: 30 },
      });
      await env.setNow(at(61_000));
      expect((await b.json("/auth/request-otp", "POST", { email: "l1@ngajigaes.test" })).status).toBe(200);
    });

    it("allows 5 codes per email per hour, for any email alike", async () => {
      await fresh();
      for (const email of ["l2@ngajigaes.test", "l2-unknown@ngajigaes.test"]) {
        const b = env.browser(); // one address per email, so this checks the email limit and not the address limit
        for (let i = 0; i < 5; i++) {
          await env.setNow(at(i * 61_000 + (email.includes("unknown") ? 1_000 : 0)));
          expect((await b.json("/auth/request-otp", "POST", { email })).status, `${email} #${i}`).toBe(200);
        }
        await env.setNow(at(5 * 61_000 + 2_000));
        const res = await b.json("/auth/request-otp", "POST", { email });
        expect(res.status).toBe(429);
        expect((await res.json()).error.details.reason).toBe("hourly_limit");
      }
    });

    it("allows 10 requests per IP per hour across different emails", async () => {
      await env.setNow(T0);
      const ip = "198.51.100.77";
      const b = env.browser(ip);
      for (let i = 0; i < 10; i++)
        expect((await b.json("/auth/request-otp", "POST", { email: `ip${i}@ngajigaes.test` })).status).toBe(200);
      const res = await b.json("/auth/request-otp", "POST", { email: "ip-extra@ngajigaes.test" });
      expect(res.status).toBe(429);
      expect((await res.json()).error.details.reason).toBe("ip_limit");
      // another address is unaffected
      expect(
        (await env.browser("198.51.100.78").json("/auth/request-otp", "POST", { email: "ip-other@ngajigaes.test" }))
          .status,
      ).toBe(200);
    });

    it("stores only hashes: no code, no email, no IP in the rate limit or code tables", async () => {
      const b = await fresh();
      await b.auth().requestOtp("plain@ngajigaes.test");
      const dump = JSON.stringify([
        await env.db.exec("select * from public.login_otps"),
        await env.db.exec("select * from public.rate_limits"),
      ]);
      expect(dump).not.toContain("plain@ngajigaes.test");
      expect(dump).not.toContain(env.readCode("plain@ngajigaes.test"));
      expect(dump).not.toContain(b.ip);
    });

    it("rejects an email that is not an email without sending anything", async () => {
      const b = await fresh();
      const res = await b.json("/auth/request-otp", "POST", { email: "not-an-email" });
      expect(res.status).toBe(400);
    });
  });

  describe("sessions", () => {
    it("/me says who is signed in, and why nobody is", async () => {
      const b = await fresh();
      expect(await b.auth().getSession()).toMatchObject({ authenticated: false, reason: "none", user: null });
      await env.grant("s1@ngajigaes.test");
      await env.signIn("s1@ngajigaes.test", { browser: b });
      const s = await b.auth().getSession();
      expect(s).toMatchObject({ authenticated: true, reason: null, user: { email: "s1@ngajigaes.test" } });
      expect(s.device_id).toBeTruthy();
    });

    it("lasts 30 days, and an active device keeps going (sliding)", async () => {
      const b = await fresh();
      await env.signIn("s2@ngajigaes.test", { browser: b });
      await env.setNow(at(20 * 86_400_000));
      expect((await b.auth().getSession()).authenticated).toBe(true); // extends to day 50
      await env.setNow(at(45 * 86_400_000));
      expect((await b.auth().getSession()).authenticated).toBe(true);
      await env.setNow(at(80 * 86_400_000));
      expect(await b.auth().getSession()).toMatchObject({ authenticated: false, reason: "expired" });
    });

    it("an idle device expires after 30 days", async () => {
      const b = await fresh();
      await env.signIn("s3@ngajigaes.test", { browser: b });
      await env.setNow(at(31 * 86_400_000));
      expect(await b.auth().getSession()).toMatchObject({ authenticated: false, reason: "expired" });
      expect(await code(b.data().access.getAccess())).toBe("UNAUTHENTICATED");
    });

    it("logout ends this device only and clears the cookie", async () => {
      const a = await fresh();
      await env.signIn("s4@ngajigaes.test", { browser: a });
      const b = await env.signIn("s4@ngajigaes.test");
      const stolen = a.cookieValue!;
      await a.auth().logout();
      expect(a.cookieValue).toBeUndefined();
      expect((await a.auth().getSession()).authenticated).toBe(false);
      expect((await b.auth().getSession()).authenticated).toBe(true);
      // replaying the old cookie does not sign in again
      const replay = env.browser();
      replay.setCookie(stolen);
      expect(await replay.auth().getSession()).toMatchObject({ authenticated: false, reason: "revoked" });
      expect(await code(replay.data().access.getAccess())).toBe("UNAUTHENTICATED");
    });

    it("a malformed, forged or foreign cookie is no session and no error", async () => {
      const b = await fresh();
      for (const v of [
        "",
        "garbage",
        "x.y",
        "00000000-0000-4000-8000-000000000000.aaaaaaaaaaaaaaaaaaaaaaaa",
        "'; drop table x; --.zzzzzzzzzzzzzzzzzzzzzzzz",
      ]) {
        b.setCookie(v);
        const r = await b.raw("/me");
        expect(r.status).toBe(200);
        expect((await r.json()).authenticated).toBe(false);
      }
    });

    it("the cookie secret does not open another device's session", async () => {
      const a = await env.signIn("s5@ngajigaes.test");
      const b = await env.signIn("s5@ngajigaes.test");
      const [devA, secA] = a.cookieValue!.split(".");
      const [devB] = b.cookieValue!.split(".");
      const forged = env.browser();
      forged.setCookie(`${devB}.${secA}`);
      expect((await forged.auth().getSession()).authenticated).toBe(false);
      expect(devA).not.toBe(devB);
    });
  });

  describe("3 device limit", () => {
    async function threeDevices(email: string) {
      await env.setNow(T0);
      const list: TestBrowser[] = [];
      for (let i = 1; i <= 3; i++) {
        await env.setNow(at(i * 61_000));
        list.push(await env.signIn(email, { label: `Perangkat ${i}` }));
      }
      return list;
    }

    it("refuses the 4th after a right code, lists the devices, and creates no session", async () => {
      const email = "d1@ngajigaes.test";
      await threeDevices(email);
      await env.setNow(at(10 * MIN));
      const four = env.browser();
      await four.auth().requestOtp(email);
      const res = await four.json("/auth/verify-otp", "POST", {
        email,
        code: env.readCode(email),
        device_label: "Perangkat 4",
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toBeNull();
      const body = await res.json();
      expect(body).toMatchObject({ status: "device_limit", max_devices: 3 });
      expect(body.devices.map((d: { label: string }) => d.label).sort()).toEqual([
        "Perangkat 1",
        "Perangkat 2",
        "Perangkat 3",
      ]);
      expect(body.pending_token.length).toBeGreaterThan(30);
      expect(await four.auth().getSession()).toMatchObject({ authenticated: false });
      expect(await code(four.data().access.getAccess())).toBe("UNAUTHENTICATED");
    });

    it("lets the user remove one device and continue: the removed device reads as revoked", async () => {
      const email = "d2@ngajigaes.test";
      const [first, second] = await threeDevices(email);
      await env.setNow(at(10 * MIN));
      const four = env.browser();
      await four.auth().requestOtp(email);
      const r = await four.auth().verifyOtp(email, env.readCode(email), "Perangkat 4");
      if (r.status !== "device_limit") throw new Error("expected device_limit");
      const victim = r.devices.find((d) => d.label === "Perangkat 1")!;
      const ok = await four.auth().completePendingLogin(r.pending_token, victim.id, "Perangkat 4");
      expect(ok.user.email).toBe(email);
      expect((await four.auth().getSession()).authenticated).toBe(true);
      expect(await first!.auth().getSession()).toMatchObject({ authenticated: false, reason: "revoked" });
      expect((await second!.auth().getSession()).authenticated).toBe(true);
      expect((await four.auth().listDevices()).map((d) => d.label).sort()).toEqual([
        "Perangkat 2",
        "Perangkat 3",
        "Perangkat 4",
      ]);
    });

    it("the permission works once and lasts 10 minutes", async () => {
      const email = "d3@ngajigaes.test";
      await threeDevices(email);
      await env.setNow(at(10 * MIN));
      const four = env.browser();
      await four.auth().requestOtp(email);
      const r = await four.auth().verifyOtp(email, env.readCode(email));
      if (r.status !== "device_limit") throw new Error("expected device_limit");
      await four.auth().completePendingLogin(r.pending_token, r.devices[0]!.id);
      const again = env.browser();
      expect(await code(again.auth().completePendingLogin(r.pending_token, r.devices[1]!.id))).toBe(
        "PENDING_LOGIN_INVALID",
      );

      await env.setNow(at(30 * MIN));
      const five = env.browser();
      await five.auth().requestOtp(email);
      const r2 = await five.auth().verifyOtp(email, env.readCode(email));
      if (r2.status !== "device_limit") throw new Error("expected device_limit");
      await env.setNow(at(30 * MIN + 10 * MIN + 1_000));
      expect(await code(five.auth().completePendingLogin(r2.pending_token, r2.devices[0]!.id))).toBe(
        "PENDING_LOGIN_INVALID",
      );
    });

    it("a made-up token is refused, and so is a device that is not the user's", async () => {
      const email = "d4@ngajigaes.test";
      const other = "d4-other@ngajigaes.test";
      await threeDevices(email);
      const [oa] = await threeDevices(other);
      const victimDevice = (await oa!.auth().listDevices())[0]!.id;
      await env.setNow(at(10 * MIN));
      const four = env.browser();
      expect(await code(four.auth().completePendingLogin("made-up-token", victimDevice))).toBe("PENDING_LOGIN_INVALID");
      await four.auth().requestOtp(email);
      const r = await four.auth().verifyOtp(email, env.readCode(email));
      if (r.status !== "device_limit") throw new Error("expected device_limit");
      expect(await code(four.auth().completePendingLogin(r.pending_token, victimDevice))).toBe("NOT_FOUND");
      expect((await oa!.auth().getSession()).authenticated).toBe(true);
    });

    it("lists and revokes devices, never the current one and never another user's", async () => {
      const [a, b] = await threeDevices("d5@ngajigaes.test");
      const [x] = await threeDevices("d5-other@ngajigaes.test");
      const list = await a!.auth().listDevices();
      expect(list.filter((d) => d.is_current)).toHaveLength(1);
      const mine = list.find((d) => d.is_current)!;
      expect(await code(a!.auth().revokeDevice(mine.id))).toBe("VALIDATION_ERROR");
      const theirs = (await x!.auth().listDevices())[0]!.id;
      expect(await code(a!.auth().revokeDevice(theirs))).toBe("NOT_FOUND");
      expect(await code(a!.auth().revokeDevice("not-a-uuid"))).toBe("NOT_FOUND");
      const bId = (await b!.auth().listDevices()).find((d) => d.is_current)!.id;
      await a!.auth().revokeDevice(bId);
      expect(await b!.auth().getSession()).toMatchObject({ authenticated: false, reason: "revoked" });
    });
  });
});

describe("Origin check on mutations (SEC-11)", () => {
  let env: ApiEnv;
  beforeAll(async () => {
    env = await createApiEnv();
  });
  afterAll(async () => env.close());

  const body = { email: "o1@ngajigaes.test" };
  it("allows the app's own origin and refuses a missing, foreign or null one", async () => {
    const b = env.browser();
    const post = (origin: string | null) =>
      b.raw("/auth/request-otp", {
        method: "POST",
        headers: { "content-type": "application/json", ...(origin === null ? {} : { origin }) },
        body: JSON.stringify(body),
      });
    // the harness adds Origin when it is absent, so build requests that bypass it
    const direct = (origin: string | null) => {
      const headers = new Headers({ "content-type": "application/json", host: "localhost:3100" });
      if (origin !== null) headers.set("origin", origin);
      return import("./api-harness").then((m) =>
        m.dispatch(
          new Request(`${ORIGIN}/api/v1/auth/request-otp`, { method: "POST", headers, body: JSON.stringify(body) }),
        ),
      );
    };
    expect((await post(ORIGIN)).status).toBe(200);
    for (const bad of [
      null,
      "https://evil.example",
      "null",
      "http://localhost:3101",
      "http://localhost.evil.example",
    ]) {
      const res = await direct(bad);
      expect(res.status, String(bad)).toBe(403);
      const err = (await res.json()).error;
      expect(err.code).toBe("FORBIDDEN_ORIGIN");
      expect(err.details.reason).toBe("origin");
    }
  });

  it("covers every mutating method, not just POST", async () => {
    const b = await env.onboarded("o2@ngajigaes.test");
    const foreign = { origin: "https://evil.example", "content-type": "application/json" };
    const cases: [string, string, unknown][] = [
      ["/me/profile", "PATCH", { display_name: "x" }],
      ["/me/preferences", "PUT", { theme_pref: "dark" }],
      ["/me/location", "PUT", { mode: "manual", timezone: "Asia/Jakarta", fajr_time: "04:30" }],
      ["/me/excuse", "POST", { from: "2026-11-20" }],
      ["/me/excuse/2026-11-20", "DELETE", undefined],
      ["/me/quran-progress/18", "PUT", { ayah: 3 }],
      ["/me/onboarding/complete", "POST", {}],
      ["/me/night-sessions", "POST", {}],
      ["/auth/logout", "POST", {}],
    ];
    for (const [path, method, payload] of cases) {
      const res = await b.raw(path, {
        method,
        headers: foreign,
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect((await res.json()).error.code, `${method} ${path}`).toBe("FORBIDDEN_ORIGIN");
    }
    // nothing changed, and the user is still signed in
    expect((await b.data().profile.getProfile()).display_name).toBeNull();
    expect((await b.auth().getSession()).authenticated).toBe(true);
  });

  it("does not ask for Origin on reads", async () => {
    const b = await env.onboarded("o3@ngajigaes.test");
    const res = await b.raw("/me/access", { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(200);
  });

  it("honours APP_ORIGINS", async () => {
    const { setDepsForTests } = await import("@/server/api/deps");
    setDepsForTests({ now: () => env.now(), cfg: { ...env.cfg, allowedOrigins: ["https://app.ngajigaes.test"] } });
    const b = env.browser();
    const res = await b.raw("/auth/request-otp", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.ngajigaes.test" },
      body: JSON.stringify({ email: "o4@ngajigaes.test" }),
    });
    expect(res.status).toBe(200);
    setDepsForTests({ now: () => env.now(), cfg: env.cfg });
  });
});
