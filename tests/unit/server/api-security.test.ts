import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setDbForTests } from "@/server/db";
import { createApiEnv, type ApiEnv, type TestBrowser } from "./api-harness";

const ID = "00000000-0000-4000-8000-0000000000aa";

/** Every private endpoint with a request that would succeed for a user with access. */
const PRIVATE: [method: string, path: string, body?: unknown][] = [
  ["GET", "/me/access"],
  ["GET", "/me/devices"],
  ["GET", "/me/profile"],
  ["PATCH", "/me/profile", { display_name: "x" }],
  ["PUT", "/me/preferences", { theme_pref: "dark" }],
  ["PUT", "/me/location", { mode: "manual", timezone: "Asia/Jakarta", fajr_time: "04:30" }],
  ["POST", "/me/onboarding/complete", {}],
  ["GET", "/regions"],
  ["GET", "/me/next-fajr"],
  ["GET", "/me/wake-plan"],
  ["GET", "/me/current-level"],
  ["GET", "/me/level-progress"],
  ["GET", "/me/night-session"],
  ["POST", "/me/night-sessions", {}],
  ["GET", `/night-sessions/${ID}`],
  ["GET", `/night-sessions/${ID}/summary`],
  ["PUT", `/session-activities/${ID}/status`, { checked: true, version: 0 }],
  [
    "POST",
    `/session-activities/${ID}/counter-operations`,
    { operations: [{ kind: "delta", operation_id: "op-1", delta: 1, client_recorded_at: "2026-11-12T02:00:00.000Z" }] },
  ],
  ["POST", "/me/excuse", { from: "2026-11-20" }],
  ["DELETE", "/me/excuse/2026-11-20"],
  ["GET", "/me/dashboard"],
  ["GET", "/me/reports?period=7"],
  ["GET", "/me/calendar"],
  ["GET", "/me/activity-stats"],
  ["GET", "/me/session-history"],
  ["GET", "/me/quran-progress"],
  ["PUT", "/me/quran-progress/18", { ayah: 3 }],
  ["GET", "/me/notification-preferences"],
];
// Reachable without paid access: sign-in itself, /me, /me/access, devices, logout.
const NO_ENTITLEMENT_NEEDED = new Set(["GET /me/access", "GET /me/devices"]);

const send = (b: TestBrowser, [method, path, body]: (typeof PRIVATE)[number]) => b.json(path, method, body);

describe("SECURITY over HTTP", () => {
  let env: ApiEnv;
  beforeAll(async () => {
    env = await createApiEnv();
  });
  afterAll(async () => env.close());

  describe("no session, no data", () => {
    it.each(PRIVATE.map((r) => [`${r[0]} ${r[1].split("?")[0]}`, r] as const))("%s answers 401", async (_name, r) => {
      const res = await send(env.browser(), r);
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
    });
  });

  describe("SECURITY-01: a user cannot reach another user's data", () => {
    let a: TestBrowser;
    let b: TestBrowser;
    let bSession: string;
    let bChecklist: { id: string; version: number };
    let bCounter: string;
    let bDevice: string;

    beforeAll(async () => {
      a = await env.onboarded("sec-a@ngajigaes.test");
      b = await env.onboarded("sec-b@ngajigaes.test");
      const bs = await b.data().session.ensureActiveSession();
      bSession = bs.id;
      const ck = bs.activities.find((x) => x.kind === "checklist")!;
      bChecklist = { id: ck.id, version: ck.version };
      bCounter = bs.activities.find((x) => x.kind === "counter" && x.key === "istighfar")!.id;
      await b.data().session.applyCounterOperations(bCounter, {
        operations: [{ kind: "delta", operation_id: "b-own", delta: 7, client_recorded_at: env.now().toISOString() }],
      });
      await b.data().profile.updateProfile({ display_name: "Rahasia B" });
      await b.data().quran.putProgress(36, { ayah: 12 });
      await b.data().excuse.addExcuse({ from: "2026-11-20" });
      bDevice = (await b.auth().listDevices())[0]!.id;
      await a.data().session.ensureActiveSession();
    });

    it("B's session, its summary and its activities read as missing", async () => {
      for (const path of [`/night-sessions/${bSession}`, `/night-sessions/${bSession}/summary`]) {
        const res = await a.raw(path);
        expect(res.status, path).toBe(404);
        expect((await res.json()).error.code).toBe("NOT_FOUND");
      }
    });

    it("a checklist tick on B's activity is refused and changes nothing", async () => {
      const res = await a.json(`/session-activities/${bChecklist.id}/status`, "PUT", {
        checked: true,
        version: bChecklist.version,
      });
      expect(res.status).toBe(404);
      const after = await b.data().session.getSession(bSession);
      expect(after.activities.find((x) => x.id === bChecklist.id)).toMatchObject({
        checked: false,
        version: bChecklist.version,
      });
    });

    it("counter operations on B's activity are rejected and B's count stays", async () => {
      const res = await a.json(`/session-activities/${bCounter}/counter-operations`, "POST", {
        operations: [
          { kind: "delta", operation_id: "a-attack", delta: 90, client_recorded_at: env.now().toISOString() },
        ],
      });
      const body = await res.json();
      expect(body.results[0]).toMatchObject({
        status: "rejected",
        error_code: "ACTIVITY_NOT_FOUND",
        authoritative_count: 0,
      });
      const after = await b.data().session.getSession(bSession);
      expect(after.activities.find((x) => x.id === bCounter)!.count).toBe(7);
    });

    it("an operation id used by B does not leak or block A", async () => {
      const own = (await a.data().session.ensureActiveSession()).activities.find((x) => x.kind === "counter")!.id;
      const res = await a.data().session.applyCounterOperations(own, {
        operations: [{ kind: "delta", operation_id: "b-own", delta: 3, client_recorded_at: env.now().toISOString() }],
      });
      expect(res.results[0]).toMatchObject({ status: "accepted", authoritative_count: 3 });
    });

    it("A cannot sign out one of B's devices", async () => {
      const res = await a.raw(`/me/devices/${bDevice}`, { method: "DELETE" });
      expect(res.status).toBe(404);
      expect((await b.auth().getSession()).authenticated).toBe(true);
    });

    it("A's lists contain none of B's data", async () => {
      const dump = JSON.stringify([
        await a.data().report.getDashboard(),
        await a.data().report.getCalendar(),
        await a.data().report.getSessionHistory(),
        await a.data().report.getReport(30),
        await a.data().quran.getProgress(),
        await a.data().profile.getProfile(),
        await a.data().notifications.getPreferences(),
        await a.auth().listDevices(),
      ]);
      expect(dump).not.toContain(bSession);
      expect(dump).not.toContain("Rahasia B");
      expect(dump).not.toContain("sec-b@");
      expect(dump).not.toContain(bDevice);
      expect(dump).not.toContain('2026-11-20","status":"excused');
      expect(await a.data().quran.getProgress()).toEqual([]);
    });

    it("ids that are not ids give a clean 404, never a server error", async () => {
      for (const bad of ["not-a-uuid", "1;drop table night_sessions", "..%2F..%2Fme", "%00"]) {
        const res = await a.raw(`/night-sessions/${bad}`);
        expect(res.status, bad).toBe(404);
        expect((await res.json()).error.code).toBe("NOT_FOUND");
      }
    });
  });

  describe("SECURITY-02: access comes from the server, and takes effect at once", () => {
    const STATES = ["pending_verification", "suspended", "revoked", "expired"] as const;

    it.each(STATES)("%s: every private endpoint answers 403 ENTITLEMENT_INACTIVE", async (state) => {
      const email = `ent-${state}@ngajigaes.test`;
      await env.grant(email, state);
      const b = await env.signIn(email);
      for (const r of PRIVATE) {
        const key = `${r[0]} ${r[1].split("?")[0]}`;
        const res = await send(b, r);
        if (NO_ENTITLEMENT_NEEDED.has(key)) {
          expect(res.status, key).toBe(200);
        } else {
          expect(res.status, key).toBe(403);
          expect((await res.json()).error.code, key).toBe("ENTITLEMENT_INACTIVE");
        }
      }
      const access = await b.data().access.getAccess();
      expect(access.access_status).toBe(
        state === "pending_verification" ? "awaiting_order_verification" : state === "expired" ? "none" : "suspended",
      );
      expect(access.onboarding_completed).toBe(false);
    });

    it("no entitlement at all behaves the same", async () => {
      const b = await env.signIn("ent-none@ngajigaes.test");
      expect((await b.raw("/me/dashboard")).status).toBe(403);
      expect(await b.data().access.getAccess()).toMatchObject({ access_status: "none", entitlement_type: null });
    });

    it("an active entitlement whose end date has passed is not active", async () => {
      const email = "ent-ended@ngajigaes.test";
      await env.db.exec(
        "insert into public.access_entitlements (email_normalized, status, starts_at, expires_at) values ($1, 'active', '2026-01-01Z', '2026-11-01Z')",
        [email],
      );
      const b = await env.signIn(email);
      expect((await b.raw("/me/dashboard")).status).toBe(403);
    });

    it("suspending takes effect on the next request without a new sign-in, and giving access back restores everything", async () => {
      const email = "ent-flip@ngajigaes.test";
      const b = await env.onboarded(email);
      await b.data().profile.updateProfile({ display_name: "Tetap ada" });
      const s = await b.data().session.ensureActiveSession();
      const uid = await env.userId(email);
      await env.db.exec("update public.access_entitlements set status = 'suspended' where user_id = $1", [uid]);
      expect((await b.raw("/me/profile")).status).toBe(403);
      expect((await b.json("/me/profile", "PATCH", { display_name: "Diubah" })).status).toBe(403);
      expect((await b.raw(`/night-sessions/${s.id}`)).status).toBe(403);
      await env.db.exec("update public.access_entitlements set status = 'active' where user_id = $1", [uid]);
      const p = await b.data().profile.getProfile();
      expect(p.display_name).toBe("Tetap ada"); // nothing was lost, and the refused write did not land
      expect((await b.data().session.getSession(s.id)).id).toBe(s.id);
    });

    it("a paid purchase made before the account existed is linked when the email is proven, not before", async () => {
      await env.grant("ent-late@ngajigaes.test");
      expect(
        (
          await env.db.exec(
            "select user_id from public.access_entitlements where email_normalized = 'ent-late@ngajigaes.test'",
          )
        )[0]!.user_id,
      ).toBeNull();
      const b = await env.signIn("ent-late@ngajigaes.test");
      expect(await b.data().access.getAccess()).toMatchObject({ access_status: "active" });
    });

    it("nothing the client sends can grant access", async () => {
      const email = "ent-forge@ngajigaes.test";
      const b = env.browser();
      await b.auth().requestOtp(email);
      const res = await b.json("/auth/verify-otp", "POST", {
        email,
        code: env.readCode(email),
        access: {
          authenticated: true,
          access_status: "active",
          entitlement_type: "lifetime",
          expires_at: null,
          onboarding_completed: true,
        },
        entitlement: "active",
        status: "active",
      });
      expect((await res.json()).access.access_status).toBe("none");
      const forged = await b.json("/me/profile", "PATCH", {
        display_name: "x",
        entitlement: "active",
        access_status: "active",
      });
      expect(forged.status).toBe(403);
      expect(await b.data().access.getAccess()).toMatchObject({ access_status: "none" });
    });
  });

  describe("SECURITY-03: status, level and progress are decided on the server", () => {
    let b: TestBrowser;
    beforeAll(async () => {
      b = await env.onboarded("sec3@ngajigaes.test");
    });

    it("there is no endpoint that writes a session, its status or a level", async () => {
      const s = await b.data().session.ensureActiveSession();
      for (const [method, path] of [
        ["PUT", `/night-sessions/${s.id}`],
        ["PATCH", `/night-sessions/${s.id}`],
        ["POST", `/night-sessions/${s.id}/complete`],
        ["PUT", "/me/current-level"],
        ["PUT", "/me/level-progress"],
        ["POST", "/me/level-progress"],
        ["PUT", "/me/night-session"],
      ] as const) {
        const res = await b.json(path, method, { status: "completed", level: 3 });
        expect([404, 405], `${method} ${path}`).toContain(res.status);
      }
      const after = await b.data().session.getSession(s.id);
      expect(after).toMatchObject({ status: "upcoming", state: "scheduled", level: 1 });
    });

    it("extra fields in a body are dropped, not stored", async () => {
      const before = await b.data().profile.getProfile();
      const res = await b.json("/me/profile", "PATCH", {
        display_name: "Zen",
        program_start_date: "2020-01-01",
        onboarding_completed: false,
        user_id: "00000000-0000-4000-8000-000000000000",
        email_normalized: "someone-else@example.com",
      });
      expect(res.status).toBe(200);
      const after = await b.data().profile.getProfile();
      expect(after).toEqual({ ...before, display_name: "Zen" });
    });

    it("creating a session ignores any level or date the client sends", async () => {
      const res = await b.json("/me/night-sessions", "POST", {
        level: 3,
        session_key: "2020-01-01",
        fajr_local_date: "2020-01-01",
      });
      expect(await res.json()).toMatchObject({ level: 1, session_key: "2026-11-12" });
    });

    it("a counter activity cannot be ticked as a checklist, and the server decides when something is done", async () => {
      const s = await b.data().session.ensureActiveSession();
      const counter = s.activities.find((x) => x.kind === "counter")!;
      const res = await b.json(`/session-activities/${counter.id}/status`, "PUT", { checked: true, version: 0 });
      expect(res.status).toBe(400);
      const r = await b.data().session.applyCounterOperations(counter.id, {
        operations: [
          {
            kind: "delta",
            operation_id: "s3-1",
            delta: 5,
            client_recorded_at: env.now().toISOString(),
            completed: true,
            authoritative_count: 999,
          } as never,
        ],
      });
      expect(r.results[0]).toMatchObject({ authoritative_count: 5, completed: false });
    });

    it("a session becomes completed only when every required activity is done, with no client say in it", async () => {
      const layer = b.data();
      let s = await layer.session.ensureActiveSession();
      const required = s.activities.filter((a) => a.required);
      for (const a of required.slice(0, -1)) {
        if (a.kind === "checklist") await layer.session.setChecklist(a.id, { checked: true, version: a.version });
        else
          await layer.session.applyCounterOperations(a.id, {
            operations: [
              {
                kind: "delta",
                operation_id: `c-${a.id}`,
                delta: a.target!,
                client_recorded_at: env.now().toISOString(),
              },
            ],
          });
      }
      s = await layer.session.getSession(s.id);
      expect(s.state).toBe("in_progress");
      const last = required.at(-1)!;
      if (last.kind === "checklist")
        await layer.session.setChecklist(last.id, { checked: true, version: last.version });
      else
        await layer.session.applyCounterOperations(last.id, {
          operations: [
            {
              kind: "delta",
              operation_id: `c-${last.id}`,
              delta: last.target!,
              client_recorded_at: env.now().toISOString(),
            },
          ],
        });
      expect((await layer.session.getSession(s.id)).state).toBe("completed");
      expect((await layer.session.getSummary(s.id)).session_status).toBe("completed");
    });
  });

  describe("every answer is private and has one error shape", () => {
    it("sets Cache-Control: private, no-store on successes, failures, 404s and 401s", async () => {
      const b = await env.onboarded("hdr@ngajigaes.test");
      const anon = env.browser();
      const answers = [
        ...(await Promise.all(PRIVATE.filter((r) => r[0] === "GET").map((r) => send(b, r)))),
        await send(anon, PRIVATE[0]!),
        await b.json("/me/profile", "PATCH", { display_name: 5 }),
        await b.raw("/does/not/exist"),
        await b.raw("/auth/request-otp", { method: "POST", headers: { origin: "https://evil.example" } }),
        await b.raw("/me"),
        await b.json("/auth/logout", "POST", {}),
      ];
      for (const res of answers) {
        expect(res.headers.get("cache-control"), String(res.status)).toBe("private, no-store");
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      }
    });

    it("errors are { error: { code, message, details? } } with no stack, SQL or secrets", async () => {
      const b = await env.onboarded("shape@ngajigaes.test");
      const bad = [
        await b.json("/me/profile", "PATCH", { display_name: 5 }),
        await b.raw("/me/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: "{not json",
        }),
        await b.raw("/me/reports?period=9"),
        await b.raw("/me/calendar?from=2026-02-30"),
        await b.json("/me/excuse", "POST", { from: "2026-02-30" }),
        await b.json("/me/location", "PUT", { mode: "region", region_id: "x" }),
        await b.raw(`/night-sessions/${ID}`),
        await b.raw("/nothing-here"),
      ];
      for (const res of bad) {
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        const body = await res.json();
        expect(Object.keys(body)).toEqual(["error"]);
        expect(typeof body.error.code).toBe("string");
        expect(typeof body.error.message).toBe("string");
        const text = JSON.stringify(body);
        for (const leak of [
          "select ",
          "public.",
          "app_private",
          "at Object",
          "node_modules",
          "PGlite",
          "stack",
          "pepper",
        ]) {
          expect(text, leak).not.toContain(leak);
        }
      }
    });

    it("refuses a body over 64 KB", async () => {
      const b = await env.onboarded("big@ngajigaes.test");
      const res = await b.json("/me/profile", "PATCH", { display_name: "x".repeat(70_000) });
      expect(res.status).toBe(400);
    });

    it("a database failure is a generic 503, with no cause in the answer", async () => {
      const b = await env.onboarded("down@ngajigaes.test");
      const real = env.db;
      setDbForTests({
        asUser: async () => {
          throw Object.assign(new Error('relation "secret_table" does not exist'), { code: "42P01" });
        },
        asService: real.asService.bind(real),
        close: async () => undefined,
      });
      try {
        const res = await b.raw("/me/dashboard");
        expect(res.status).toBe(503);
        const text = JSON.stringify(await res.json());
        expect(text).toContain("NOT_AVAILABLE");
        expect(text).not.toContain("secret_table");
      } finally {
        setDbForTests(real);
      }
    });
  });
});
