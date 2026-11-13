import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/webhooks/scalev/route";
import type { PgliteDb } from "@/server/db/pglite";
import { setServicesForTests } from "@/server/jobs/services";
import { MAX_BODY_BYTES, handleScalevWebhook } from "@/server/scalev/intake";
import { openPayload } from "@/server/scalev/seal";
import { createJobsDb, jobsByType, makeServices, resetJobsTables } from "./jobs-harness";
import {
  OLD_SECRET,
  ORDER_ID,
  PAYLOAD_KEY,
  SECRET,
  envelope,
  fixture,
  scalevConfig,
  scalevEnv,
  signedRequest,
} from "./scalev-harness";

let db: PgliteDb;
beforeAll(async () => {
  db = await createJobsDb();
});
afterAll(async () => db.close());
beforeEach(async () => {
  await resetJobsTables(db);
  await db.exec("delete from public.webhook_events");
});

const logs: { event: string; fields: Record<string, unknown> }[] = [];
const deps = (over: Partial<Parameters<typeof handleScalevWebhook>[1]> = {}) => ({
  db: async () => db,
  config: scalevConfig(),
  env: scalevEnv(),
  log: (event: string, fields: Record<string, unknown> = {}) => void logs.push({ event, fields }),
  ...over,
});
const events = () => db.exec("select * from public.webhook_events order by received_at, id");
const count = async (t: string) => Number((await db.exec(`select count(*)::int as n from public.${t}`))[0]!.n);

describe("SCALEV-01 signature", () => {
  it("a wrong signature is 401, and nothing is written, not even the database is opened", async () => {
    const open = vi.fn(async () => db);
    const body = fixture("webhook-payment-received.json");
    for (const req of [
      signedRequest(body, { secret: "not-the-secret-" + "x".repeat(20) }),
      signedRequest(body, { headers: { "x-scalev-hmac-sha256": "" } }),
      signedRequest(body, { headers: { "x-scalev-hmac-sha256": "not base64 !!" } }),
      signedRequest(body, { headers: { "x-scalev-hmac-sha256": "AAAA" } }),
      new Request("http://localhost/api/v1/webhooks/scalev", { method: "POST", body: JSON.stringify(body) }),
    ]) {
      const res = await handleScalevWebhook(req, deps({ db: open }));
      expect(res.status).toBe(401);
    }
    expect(open).not.toHaveBeenCalled();
    expect(await count("webhook_events")).toBe(0);
    expect(await count("jobs")).toBe(0);
  });

  it("a body changed after signing is rejected (the signature covers the exact bytes)", async () => {
    const good = signedRequest(fixture("webhook-payment-received.json"));
    const header = good.headers.get("x-scalev-hmac-sha256")!;
    const tampered = JSON.stringify({ ...fixture("webhook-payment-received.json"), unique_id: "evt_other" });
    const res = await handleScalevWebhook(
      signedRequest(null, { raw: tampered, headers: { "x-scalev-hmac-sha256": header } }),
      deps(),
    );
    expect(res.status).toBe(401);
    expect(await count("webhook_events")).toBe(0);
  });

  it("the reject log has metadata only: reason, size and a keyed ip hash, never the body or the header", async () => {
    logs.length = 0;
    const req = signedRequest(fixture("webhook-payment-received.json"), {
      secret: "wrong-" + "y".repeat(30),
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    await handleScalevWebhook(req, deps());
    const line = JSON.stringify(logs);
    expect(logs[0]!.event).toBe("webhook_rejected");
    expect(logs[0]!.fields).toMatchObject({ reason: "bad_signature", bytes: expect.any(Number) });
    expect(String(logs[0]!.fields.ip_hash)).toMatch(/^[0-9a-f]{16}$/);
    expect(line).not.toContain("203.0.113.9");
    expect(line).not.toContain("ORD-DEMO-0001");
    expect(line).not.toContain("x-scalev-hmac");
  });
});

describe("SCALEV-02 size limit", () => {
  it("a declared Content-Length over 256 KB is 413 before any reading", async () => {
    const req = new Request("http://localhost/api/v1/webhooks/scalev", {
      method: "POST",
      headers: { "content-length": String(MAX_BODY_BYTES + 1), "x-scalev-hmac-sha256": "x" },
      body: "{}",
    });
    expect((await handleScalevWebhook(req, deps())).status).toBe(413);
  });

  it("a body that is bigger than it says (or says nothing) is cut off at 256 KB with 413", async () => {
    // No Content-Length at all: an endless stream is counted and cut off.
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(chunk);
      },
    });
    const noLength = new Request("http://localhost/api/v1/webhooks/scalev", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await handleScalevWebhook(noLength, deps())).status).toBe(413);
    // A lying Content-Length does not help either: the real bytes are counted.
    const big = JSON.stringify({ ...envelope("payment.received", "evt_big"), pad: "x".repeat(MAX_BODY_BYTES) });
    const lying = signedRequest(null, { raw: big });
    expect(
      (
        await handleScalevWebhook(
          new Request(lying.url, { method: "POST", headers: lying.headers, body: big }),
          deps({}),
        )
      ).status,
    ).toBe(413);
    expect(await count("webhook_events")).toBe(0);
  });

  it("a body just under the limit is accepted", async () => {
    const pad = "x".repeat(MAX_BODY_BYTES - 400);
    const body = { ...envelope("order.updated", "evt_just_under"), pad };
    expect(JSON.stringify(body).length).toBeLessThan(MAX_BODY_BYTES);
    expect((await handleScalevWebhook(signedRequest(body), deps())).status).toBe(200);
  });
});

describe("SCALEV-03 not configured", () => {
  it("no signing secret: 503, so saving the webhook in the Scalev dashboard fails loudly", async () => {
    const res = await handleScalevWebhook(
      signedRequest(fixture("webhook-test-event.json")),
      deps({ config: scalevConfig({ SCALEV_WEBHOOK_SIGNING_SECRET: "" }) }),
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("NOT_AVAILABLE");
    expect(await count("webhook_events")).toBe(0);
  });

  it("no payload key: 503 as well, and nothing is stored in clear text instead", async () => {
    for (const bad of ["", "short", Buffer.alloc(16).toString("base64"), "!!!"]) {
      const res = await handleScalevWebhook(
        signedRequest(fixture("webhook-payment-received.json")),
        deps({ config: scalevConfig({ SCALEV_PAYLOAD_KEY: bad }) }),
      );
      expect(res.status, bad).toBe(503);
    }
    expect(await count("webhook_events")).toBe(0);
  });

  it("the route reads the environment on every call", async () => {
    vi.stubEnv("SCALEV_WEBHOOK_SIGNING_SECRET", "");
    try {
      const res = await POST(signedRequest(fixture("webhook-test-event.json")));
      expect(res.status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("accepting an event", () => {
  it("a signed payment.received is stored and one scalev_event job is queued, with no email or name in the plain columns", async () => {
    const body = fixture("webhook-payment-received.json");
    logs.length = 0;
    const net = vi.spyOn(globalThis, "fetch");
    const res = await handleScalevWebhook(signedRequest(body), deps());
    expect(net).not.toHaveBeenCalled(); // no outbound call while the request is open (PRD §19.8.6)
    net.mockRestore();
    expect(logs[0]).toMatchObject({
      event: "webhook_accepted",
      fields: { kind: "payment.received", duplicate: false, trigger: true },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [row] = await events();
    expect(row).toMatchObject({
      provider: "scalev",
      external_event_id: "evt_paid_0001",
      event_type: "payment.received",
      scalev_order_id: ORDER_ID,
      process_status: "received",
      payload_minimal: {
        event: "payment.received",
        order_number: "ORD-DEMO-0001",
        payment_status: "paid",
        status: "confirmed",
      },
    });
    expect(String(row!.payload_sha256)).toMatch(/^[0-9a-f]{64}$/);
    const jobs = await jobsByType(db, "scalev_event");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      status: "queued",
      dedupe_key: "scalev:evt:evt_paid_0001",
      payload: { webhook_event_id: row!.id },
    });
  });

  it("SCALEV-10 the payload is stored encrypted: no plain text in the row, and it opens only with the key and its own event id", async () => {
    const body = { ...fixture("webhook-order-created.json") };
    await handleScalevWebhook(signedRequest(body), deps());
    const [row] = await db.exec("select payload_encrypted, payload_minimal::text as m from public.webhook_events");
    const bytes = Buffer.from(row!.payload_encrypted as Uint8Array);
    expect(bytes[0]).toBe(1);
    for (const secretish of ["pembeli.demo@example.test", "081234560001", "TT-LIFETIME", "destination_address"]) {
      expect(bytes.toString("latin1")).not.toContain(secretish);
      expect(String(row!.m)).not.toContain(secretish);
    }
    const key = Buffer.from(PAYLOAD_KEY, "base64");
    expect(JSON.parse(openPayload(key, bytes, "scalev:evt_created_0001").toString("utf8"))).toEqual(body);
    expect(() => openPayload(key, bytes, "scalev:evt_other")).toThrow();
    expect(() => openPayload(Buffer.alloc(32, 1), bytes, "scalev:evt_created_0001")).toThrow();
    // two payloads never share a nonce
    await handleScalevWebhook(signedRequest(envelope("payment.received", "evt_x2")), deps());
    const all = await db.exec("select payload_encrypted from public.webhook_events");
    expect(
      new Set(
        all.map((r) =>
          Buffer.from(r.payload_encrypted as Uint8Array)
            .subarray(1, 13)
            .toString("hex"),
        ),
      ).size,
    ).toBe(2);
  });

  it("SCALEV-04 the same unique_id twice: 200 both times, one row, one job", async () => {
    const body = fixture("webhook-payment-received.json");
    const a = await handleScalevWebhook(signedRequest(body), deps());
    const b = await handleScalevWebhook(signedRequest(body), deps());
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await b.json()).toEqual({ ok: true, duplicate: true });
    expect(await count("webhook_events")).toBe(1);
    expect(await jobsByType(db, "scalev_event")).toHaveLength(1);
  });

  it("SCALEV-04 two deliveries at the same moment still make one row and one job", async () => {
    const body = fixture("webhook-payment-received.json");
    const r = await Promise.all([1, 2, 3, 4].map(() => handleScalevWebhook(signedRequest(body), deps())));
    expect(r.map((x) => x.status)).toEqual([200, 200, 200, 200]);
    expect(await count("webhook_events")).toBe(1);
    expect(await jobsByType(db, "scalev_event")).toHaveLength(1);
  });

  it("SCALEV-05 during a rotation both the new and the previous secret are accepted; a third one is not", async () => {
    const cfg = scalevConfig({ SCALEV_WEBHOOK_SIGNING_SECRET_PREVIOUS: OLD_SECRET });
    expect(
      (
        await handleScalevWebhook(
          signedRequest(envelope("payment.received", "evt_n"), { secret: SECRET }),
          deps({ config: cfg }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handleScalevWebhook(
          signedRequest(envelope("payment.received", "evt_o"), { secret: OLD_SECRET }),
          deps({ config: cfg }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handleScalevWebhook(
          signedRequest(envelope("payment.received", "evt_p"), { secret: "c".repeat(40) }),
          deps({ config: cfg }),
        )
      ).status,
    ).toBe(401);
    // without PREVIOUS the old secret is rejected again
    expect(
      (await handleScalevWebhook(signedRequest(envelope("payment.received", "evt_q"), { secret: OLD_SECRET }), deps()))
        .status,
    ).toBe(401);
    expect(await count("webhook_events")).toBe(2);
  });

  it("business.test_event is answered 200 with no effect at all", async () => {
    const res = await handleScalevWebhook(signedRequest(fixture("webhook-test-event.json")), deps());
    expect(res.status).toBe(200);
    expect(await count("webhook_events")).toBe(0);
    expect(await count("jobs")).toBe(0);
  });

  it("events that are not triggers are kept as ignored, with no job: order.created, order.updated, unknown events", async () => {
    for (const f of ["webhook-order-created.json", "webhook-order-updated.json"]) {
      expect((await handleScalevWebhook(signedRequest(fixture(f)), deps())).status).toBe(200);
    }
    expect((await handleScalevWebhook(signedRequest(envelope("something.new", "evt_new")), deps())).status).toBe(200);
    const rows = await events();
    expect(rows.map((r) => r.process_status)).toEqual(["ignored", "ignored", "ignored"]);
    expect(rows.map((r) => r.error_message)).toEqual(["not_a_trigger", "not_a_trigger", "not_a_trigger"]);
    expect(await count("jobs")).toBe(0);
  });

  it("the other trigger events queue a job: payment.failed, order.status_changed, order.deleted", async () => {
    await handleScalevWebhook(signedRequest(fixture("webhook-payment-failed.json")), deps());
    await handleScalevWebhook(signedRequest(fixture("webhook-order-status-changed.json")), deps());
    await handleScalevWebhook(signedRequest(envelope("order.deleted", "evt_del")), deps());
    expect(await jobsByType(db, "scalev_event")).toHaveLength(3);
  });

  it("a trigger without a usable order id is kept as ignored: the worker has nothing to read", async () => {
    for (const [uid, data] of [
      ["evt_no_id", { order_id: "ORD-1" }],
      ["evt_bad_id", { id: "../../v3/stores" }],
      ["evt_num_id", { id: 12345 }],
    ] as const) {
      expect((await handleScalevWebhook(signedRequest(envelope("payment.received", uid, data)), deps())).status).toBe(
        200,
      );
    }
    const rows = await events();
    expect(rows.map((r) => [r.process_status, r.error_message, r.scalev_order_id])).toEqual([
      ["ignored", "missing_order_id", null],
      ["ignored", "missing_order_id", null],
      ["ignored", "missing_order_id", null],
    ]);
    expect(await count("jobs")).toBe(0);
  });

  it("a signed body with the wrong shape is 400 and writes nothing", async () => {
    for (const raw of [
      "not json",
      "[]",
      JSON.stringify({ event: "payment.received" }),
      JSON.stringify({ ...envelope("x", "y"), data: "nope" }),
    ]) {
      expect((await handleScalevWebhook(signedRequest(null, { raw }), deps())).status, raw).toBe(400);
    }
    expect(await count("webhook_events")).toBe(0);
  });

  it("a database that is down is 503, so Scalev sends the event again", async () => {
    const res = await handleScalevWebhook(
      signedRequest(fixture("webhook-payment-received.json")),
      deps({
        db: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      }),
    );
    expect(res.status).toBe(503);
  });

  it("the route works through the shared services and answers with no-store", async () => {
    setServicesForTests(makeServices(db));
    vi.stubEnv("SCALEV_WEBHOOK_SIGNING_SECRET", SECRET);
    vi.stubEnv("SCALEV_PAYLOAD_KEY", PAYLOAD_KEY);
    try {
      const res = await POST(signedRequest(fixture("webhook-payment-received.json")));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await count("webhook_events")).toBe(1);
    } finally {
      vi.unstubAllEnvs();
      setServicesForTests(null);
    }
  });
});
