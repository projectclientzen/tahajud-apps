import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgliteDb } from "@/server/db/pglite";
import { setServicesForTests } from "@/server/jobs/services";
import { GET, POST } from "@/app/api/internal/cron/route";
import { createJobsDb, jobsByType, makeServices, resetJobsTables } from "./jobs-harness";

let db: PgliteDb;
beforeAll(async () => {
  db = await createJobsDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetJobsTables(db);
  setServicesForTests(makeServices(db));
});
afterEach(() => {
  vi.unstubAllEnvs();
  setServicesForTests(null);
});

const SECRET = "s".repeat(40);
const call = (method: "GET" | "POST", headers: Record<string, string> = {}) =>
  (method === "POST" ? POST : GET)(new Request("http://localhost:3100/api/internal/cron", { method, headers }));

describe("/api/internal/cron", () => {
  it("refuses everything when CRON_SECRET is not set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await call("POST", { authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("NOT_AVAILABLE");
    expect(await jobsByType(db, "housekeeping")).toHaveLength(0);
  });

  it("refuses a secret that is too short to be safe", async () => {
    vi.stubEnv("CRON_SECRET", "short");
    expect((await call("POST", { authorization: "Bearer short" })).status).toBe(503);
  });

  it("rejects a missing or wrong secret with 401 and does no work", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const headers of [{}, { authorization: "Bearer nope" }, { "x-cron-secret": "nope" }, { authorization: SECRET }, { authorization: `Bearer ${SECRET}x` }]) {
      const res = await call("POST", headers);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Tidak diizinkan." } });
    }
    expect((await db.exec("select count(*)::int as n from public.jobs"))[0]!.n).toBe(0);
  });

  it("accepts the secret as a bearer token (Vercel Cron) or as x-cron-secret, on POST and GET", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const [method, headers] of [
      ["POST", { authorization: `Bearer ${SECRET}` }],
      ["POST", { "x-cron-secret": SECRET }],
      ["GET", { authorization: `Bearer ${SECRET}` }],
    ] as const) {
      const res = await call(method, headers);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("runs a tick: creates the recurring jobs and works them, and the answer has counts but no secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const res = await call("POST", { authorization: `Bearer ${SECRET}` });
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const body = JSON.parse(text);
    expect(body.ok).toBe(true);
    expect(body.enqueued.sort()).toEqual(["housekeeping", "notification_schedule", "prayer_sync"]);
    expect(body.run.claimed).toBe(3);
    // prayer_sync has no provider configured: it fails with a clear, stored message and is not retried.
    const [sync] = await jobsByType(db, "prayer_sync");
    expect(sync).toMatchObject({ status: "failed" });
    expect(String(sync!.last_error)).toMatch(/PRAYER_PROVIDER/);
    expect((await jobsByType(db, "housekeeping"))[0]).toMatchObject({ status: "done" });
  });

  it("two calls in the same minute do not create the recurring jobs twice", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const h = { authorization: `Bearer ${SECRET}` };
    await Promise.all([call("POST", h), call("POST", h)]);
    for (const t of ["notification_schedule", "prayer_sync", "housekeeping"]) expect(await jobsByType(db, t)).toHaveLength(1);
  });

  it("does not leak internals when the database is down", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    setServicesForTests(makeServices({ ...db, asService: () => Promise.reject(new Error("password authentication failed for user postgres")) } as unknown as PgliteDb));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await call("POST", { authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/password|postgres/);
    err.mockRestore();
  });
});
