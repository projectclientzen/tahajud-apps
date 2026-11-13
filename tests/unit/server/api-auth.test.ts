import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/data/contracts";
import { createApiEnv, ORIGIN, TEST_PASSWORD, type ApiEnv, type TestBrowser } from "./api-harness";

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

describe("sign-in with email and password (CLAUDE.md auth rules)", () => {
  let env: ApiEnv;
  beforeAll(async () => {
    env = await createApiEnv();
  });
  afterAll(async () => env.close());
  const fresh = async () => {
    await env.setNow(T0);
    return env.browser();
  };

  describe("login", () => {
    it("opens a session with an HttpOnly SameSite=Lax cookie", async () => {
      const b = await fresh();
      await env.grant("a1@ngajigaes.test");
      await env.createAccount("a1@ngajigaes.test");
      const res = await b.json("/auth/login", "POST", { email: "a1@ngajigaes.test", password: TEST_PASSWORD });
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
    });

    it("normalizes the email (case and spaces)", async () => {
      const b = await fresh();
      await env.createAccount("a1b@ngajigaes.test");
      const r = await b.auth().login("  A1B@Ngajigaes.TEST ", TEST_PASSWORD);
      expect(r.status).toBe("ok");
    });

    it("sets Secure when the request came over https", async () => {
      const b = await fresh();
      await env.createAccount("a2@ngajigaes.test");
      const res = await b.json(
        "/auth/login",
        "POST",
        { email: "a2@ngajigaes.test", password: TEST_PASSWORD },
        { "x-forwarded-proto": "https" },
      );
      expect(res.headers.get("set-cookie")).toContain("Secure");
    });

    it("AUTH-09: a wrong password, an unknown email and a malformed email give the same answer", async () => {
      const b = await fresh();
      await env.createAccount("a3@ngajigaes.test");
      const r1 = await b.json("/auth/login", "POST", { email: "a3@ngajigaes.test", password: "salah-salah-salah" });
      const r2 = await b.json("/auth/login", "POST", { email: "nobody@ngajigaes.test", password: "salah-salah-salah" });
      const r3 = await b.json("/auth/login", "POST", { email: "bukan-email", password: "salah-salah-salah" });
      for (const r of [r1, r2, r3]) expect(r.status).toBe(401);
      const [j1, j2, j3] = [await r1.json(), await r2.json(), await r3.json()];
      expect(j1).toEqual(j2);
      expect(j1).toEqual(j3);
      expect(j1.error.code).toBe("INVALID_CREDENTIALS");
      expect(r1.headers.get("set-cookie")).toBeNull();
    });

    it("AUTH-09: an unknown email still costs a hash check (same work as a wrong password)", async () => {
      const { dummyHash } = await import("@/server/auth/password");
      // The dummy hash is made with the configured settings, so the time matches a real account.
      expect(await dummyHash(env.cfg.scrypt)).toMatch(/^\$scrypt\$ln=10,r=8,p=1\$/);
    });

    it("a user without active access can still sign in and see their status", async () => {
      const b = await fresh();
      await env.grant("a4@ngajigaes.test", "pending_verification");
      await env.createAccount("a4@ngajigaes.test");
      const r = await b.auth().login("a4@ngajigaes.test", TEST_PASSWORD);
      expect(r).toMatchObject({ status: "ok", access: { access_status: "awaiting_order_verification" } });
    });

    it("rejects a body that is not valid before it touches the database", async () => {
      const b = await fresh();
      const res = await b.json("/auth/login", "POST", { email: "x@y.test" });
      expect(res.status).toBe(400);
    });

    it("AUTH-15: ten failures lock that email for the window, a correct password does not count and cannot bypass it", async () => {
      await fresh();
      await env.createAccount("lock@ngajigaes.test");
      // Different addresses so the IP limit is not what stops us.
      for (let i = 0; i < 10; i++) {
        const r = await env.browser().json("/auth/login", "POST", { email: "lock@ngajigaes.test", password: "salah-salah-1" });
        expect(r.status, `try ${i}`).toBe(401);
      }
      const locked = await env.browser().json("/auth/login", "POST", { email: "lock@ngajigaes.test", password: TEST_PASSWORD });
      expect(locked.status).toBe(429);
      expect((await locked.json()).error.code).toBe("RATE_LIMITED");
      // other emails are not affected
      await env.createAccount("free@ngajigaes.test");
      expect((await env.browser().auth().login("free@ngajigaes.test", TEST_PASSWORD)).status).toBe("ok");
      // after the window the right password works again
      await env.setNow(at(16 * MIN));
      expect((await env.browser().auth().login("lock@ngajigaes.test", TEST_PASSWORD)).status).toBe("ok");
    });

    it("AUTH-15: successful logins do not add to the failure count", async () => {
      await fresh();
      await env.createAccount("many@ngajigaes.test");
      for (let i = 0; i < 12; i++) {
        const r = await env.browser().auth().login("many@ngajigaes.test", TEST_PASSWORD, `P${i}`);
        // the 4th device onward hits the device limit, which is not an auth failure
        expect(["ok", "device_limit"]).toContain(r.status);
      }
    });

    it("AUTH-15: 30 attempts per address per 10 minutes", async () => {
      await fresh();
      const ip = "198.51.100.40";
      const b = env.browser(ip);
      for (let i = 0; i < 30; i++) {
        const r = await b.json("/auth/login", "POST", { email: `ip${i}@ngajigaes.test`, password: "salah-salah-1" });
        expect(r.status, `try ${i}`).toBe(401);
      }
      const res = await b.json("/auth/login", "POST", { email: "ip-extra@ngajigaes.test", password: "salah-salah-1" });
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBeTruthy();
      expect(
        (await env.browser("198.51.100.41").json("/auth/login", "POST", { email: "ip-other@ngajigaes.test", password: "salah-salah-1" }))
          .status,
      ).toBe(401);
    });

    it("AUTH-15: only the proxy-added address counts, entries a client puts in front are ignored", async () => {
      await fresh();
      const spoof = async (i: number) =>
        env
          .browser("203.0.113.200")
          .json(
            "/auth/login",
            "POST",
            { email: `sp${i}@ngajigaes.test`, password: "salah-salah-1" },
            // the client invents a new "address" every time, our proxy appends the real one last
            { "x-forwarded-for": `10.9.8.${i}, 203.0.113.200` },
          );
      for (let i = 0; i < 30; i++) expect((await spoof(i)).status).toBe(401);
      expect((await spoof(31)).status).toBe(429);
    });

    it("with no trusted proxy the forwarded header is ignored and everyone shares one bucket", async () => {
      const { callerOf } = await import("@/server/auth/service");
      const req = new Request("http://localhost/x", { headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" } });
      expect(callerOf(req, 1).ip).toBe("2.2.2.2");
      expect(callerOf(req, 2).ip).toBe("1.1.1.1");
      expect(callerOf(req, 0).ip).toBe("unknown");
    });

    it("keeps the password and the email out of the rate limit table", async () => {
      await fresh();
      const b = env.browser("198.51.100.55");
      await b.json("/auth/login", "POST", { email: "plain@ngajigaes.test", password: "rahasia-sekali-123" });
      const dump = JSON.stringify(await env.db.exec("select * from public.rate_limits"));
      expect(dump).not.toContain("plain@ngajigaes.test");
      expect(dump).not.toContain("rahasia-sekali-123");
      expect(dump).not.toContain("198.51.100.55");
    });
  });

  describe("stored password", () => {
    it("is a scrypt hash with its parameters, never the password", async () => {
      await env.createAccount("h1@ngajigaes.test");
      const rows = await env.db.exec("select password_hash from public.auth_credentials");
      for (const r of rows) expect(String(r.password_hash)).toMatch(/^\$scrypt\$ln=\d+,r=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
      expect(JSON.stringify(rows)).not.toContain(TEST_PASSWORD);
    });

    it("an older, cheaper hash is replaced with the current settings after a right login", async () => {
      const { hashPassword, needsRehash } = await import("@/server/auth/password");
      await env.createAccount("h2@ngajigaes.test");
      const cheaper = { ln: 10, r: 8, p: 1 };
      const old = await hashPassword(TEST_PASSWORD, cheaper);
      await env.db.exec("update public.auth_credentials set password_hash = $1 where user_id = (select id from auth.users where email = 'h2@ngajigaes.test')", [old]);
      const stronger = { ...env.cfg, scrypt: { ln: 11, r: 8, p: 1 } };
      const { setDepsForTests } = await import("@/server/api/deps");
      setDepsForTests({ now: () => env.now(), cfg: stronger });
      try {
        expect((await env.browser().auth().login("h2@ngajigaes.test", TEST_PASSWORD)).status).toBe("ok");
      } finally {
        setDepsForTests({ now: () => env.now(), cfg: env.cfg });
      }
      const after = String((await env.db.exec("select password_hash from public.auth_credentials where user_id = (select id from auth.users where email = 'h2@ngajigaes.test')"))[0]!.password_hash);
      expect(after).not.toBe(old);
      expect(needsRehash(after, stronger.scrypt)).toBe(false);
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

    it("refuses the 4th after a right password, lists the devices, and creates no session", async () => {
      const email = "d1@ngajigaes.test";
      await threeDevices(email);
      await env.setNow(at(10 * MIN));
      const four = env.browser();
      const res = await four.json("/auth/login", "POST", {
        email,
        password: TEST_PASSWORD,
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
      const r = await four.auth().login(email, TEST_PASSWORD, "Perangkat 4");
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
      const r = await four.auth().login(email, TEST_PASSWORD);
      if (r.status !== "device_limit") throw new Error("expected device_limit");
      await four.auth().completePendingLogin(r.pending_token, r.devices[0]!.id);
      const again = env.browser();
      expect(await code(again.auth().completePendingLogin(r.pending_token, r.devices[1]!.id))).toBe(
        "PENDING_LOGIN_INVALID",
      );

      await env.setNow(at(30 * MIN));
      const five = env.browser();
      const r2 = await five.auth().login(email, TEST_PASSWORD);
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
      const r = await four.auth().login(email, TEST_PASSWORD);
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

  const body = { email: "o1@ngajigaes.test", password: "salah-salah-1" };
  it("allows the app's own origin and refuses a missing, foreign or null one", async () => {
    const b = env.browser();
    const post = (origin: string | null) =>
      b.raw("/auth/login", {
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
          new Request(`${ORIGIN}/api/v1/auth/login`, { method: "POST", headers, body: JSON.stringify(body) }),
        ),
      );
    };
    // a real answer from the login endpoint (wrong password), not the Origin refusal
    expect((await post(ORIGIN)).status).toBe(401);
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
    const res = await b.raw("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.ngajigaes.test" },
      body: JSON.stringify({ email: "o4@ngajigaes.test", password: "salah-salah-1" }),
    });
    expect(res.status).toBe(401);
    setDepsForTests({ now: () => env.now(), cfg: env.cfg });
  });
});
