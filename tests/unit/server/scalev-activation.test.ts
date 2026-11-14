import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setServicesForTests } from "@/server/jobs/services";
import { signBody } from "@/server/scalev/signature";
import { ORIGIN, createApiEnv, dispatch, type ApiEnv } from "./api-harness";
import { FakeScalev } from "./scalev-fake";
import { ORDER_ID, PAYLOAD_KEY, SECRET, envelope, fixture, scalevEnv } from "./scalev-harness";
import { buildHandlers } from "@/server/jobs/handlers";
import { runJobs } from "@/server/jobs/runner";
import { makeServices } from "./jobs-harness";
import { ScalevClient } from "@/server/scalev/client";
import { loadScalevConfig } from "@/server/scalev/config";

let env: ApiEnv;
let fake: FakeScalev;
beforeAll(async () => {
  env = await createApiEnv();
  fake = await FakeScalev.start();
});
afterAll(async () => {
  await fake.stop();
  await env.close();
});
beforeEach(async () => {
  // Later than the real clock, so the jobs the webhook route files (stamped with the real time) are already due.
  await env.setNow(new Date(Date.now() + 3600_000).toISOString());
  await env.db.exec("with g as (delete from public.auth_fail_state) delete from public.rate_limits");
  fake.reset();
  vi.stubEnv("SCALEV_WEBHOOK_SIGNING_SECRET", SECRET);
  vi.stubEnv("SCALEV_PAYLOAD_KEY", PAYLOAD_KEY);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  setServicesForTests(null);
  await env.db.exec("delete from public.jobs");
  await env.db.exec("update public.access_entitlements set user_id = null");
  await env.db.exec("delete from public.auth_credentials");
  await env.db.exec("delete from public.user_devices");
  await env.db.exec("delete from public.profiles");
  await env.db.exec("delete from auth.users");
  await env.db.exec("delete from public.access_entitlements");
  await env.db.exec("delete from public.purchase_orders");
  await env.db.exec("delete from public.webhook_events");
});

const PASSWORD = "kata-sandi-aktivasi-panjang";
const EMAIL = "pembeli.demo@example.test";

/** The services the worker and the webhook route share, wired to the test database and the fake Scalev. */
function services() {
  const config = loadScalevConfig(scalevEnv({ SCALEV_API_BASE: fake.url }));
  const svc = makeServices(env.db, {
    now: () => env.now(),
    scalev: { config, client: new ScalevClient({ baseUrl: fake.url, apiKey: config.apiKey! }), pepper: env.cfg.phoneKey },
  });
  setServicesForTests(svc);
  return svc;
}

/** The webhook as Scalev sends it: POST to the real route with a signature over the raw body. */
async function postWebhook(body: unknown): Promise<Response> {
  const raw = JSON.stringify(body);
  return dispatch(
    new Request(`${ORIGIN}/api/v1/webhooks/scalev`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-scalev-hmac-sha256": signBody(raw, SECRET) },
      body: raw,
    }),
  );
}

const work = (svc: ReturnType<typeof services>) =>
  runJobs({ db: env.db, now: svc.now, log: svc.log, workerId: "e2e" }, buildHandlers(svc), { maxJobs: 20 });
/** ACTIVATION_FAILED answers 400 for every reason (src/server/auth), so nothing says which proof was wrong. */
const activate = (email: string, phone: string, password = PASSWORD) =>
  env.browser().json("/auth/activate", "POST", { email, phone, password, device_label: "HP baru" });

describe("a paid Scalev order to a working account", () => {
  it("signed webhook, job, GET of the order, entitlement, activation with email and phone, then login", async () => {
    const svc = services();
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });

    // Before anything happens nobody can activate.
    expect((await activate(EMAIL, "081234560001")).status).toBe(400);

    const hook = await postWebhook(
      envelope("payment.received", "evt-e2e", {
        id: ORDER_ID,
        order_id: "ORD-DEMO-0001",
        payment_status: "paid",
        status: "confirmed",
      }),
    );
    expect(hook.status).toBe(200);
    // The webhook alone gives nothing: it only filed a job.
    expect(await env.db.exec("select 1 from public.access_entitlements")).toHaveLength(0);
    expect((await activate(EMAIL, "081234560001")).status).toBe(400);

    const r = await work(svc);
    expect(r.byType.scalev_event).toBe(1);
    expect(r.failed + r.dead).toBe(0);
    expect(await env.db.exec("select status, user_id from public.access_entitlements")).toEqual([
      { status: "active", user_id: null },
    ]);

    // The order says 0812-3456-0001; the buyer types it another way.
    const b = env.browser();
    const res = await b.json("/auth/activate", "POST", {
      email: "  Pembeli.Demo@Example.test ",
      phone: "+62 812 3456 0001",
      password: PASSWORD,
      device_label: "HP baru",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: "ok",
      user: { email: EMAIL },
      access: { access_status: "active" },
    });
    expect((await b.auth().getSession()).authenticated).toBe(true);

    // The entitlement now belongs to the new account, and the password works on another device.
    const uid = await env.userId(EMAIL);
    expect(await env.db.exec("select user_id::text as u from public.access_entitlements")).toEqual([{ u: uid }]);
    const login = await env.browser().auth().login(EMAIL, PASSWORD, "Laptop");
    expect(login.status).toBe("ok");

    // One activation per entitlement. (The failed tries above used up the per-pair limit, so start the counters again.)
    await env.db.exec("with g as (delete from public.auth_fail_state) delete from public.rate_limits");
    expect((await activate(EMAIL, "081234560001")).status).toBe(400);
  });

  it("a wrong phone cannot activate, even with the right email", async () => {
    const svc = services();
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    await postWebhook(envelope("payment.received", "evt-wp", { id: ORDER_ID, payment_status: "paid" }));
    await work(svc);
    for (const phone of ["081234560002", "081299990000", "6281234560001x"])
      expect((await activate(EMAIL, phone)).status, phone).toBe(400);
    expect((await activate("lain@example.test", "081234560001")).status).toBe(400);
    expect(await env.db.exec("select 1 from public.auth_credentials")).toHaveLength(0);
  });

  it.each([
    "order-no-phone.json",
    "order-no-email.json",
    "order-foreign-variant.json",
    "order-spam.json",
    "order-canceled.json",
    "order-unpaid.json",
  ])("%s can never be activated", async (file) => {
    const svc = services();
    fake.onOrder(ORDER_ID, { body: fixture(file) });
    await postWebhook(envelope("payment.received", "evt-nope", { id: ORDER_ID, payment_status: "paid" }));
    await work(svc);
    expect(await env.db.exec("select 1 from public.access_entitlements")).toHaveLength(0);
    expect((await activate(EMAIL, "081234560001")).status).toBe(400);
    expect((await activate(EMAIL, "0812-3456-0001")).status).toBe(400);
  });

  it("a delivery address phone works as the proof when the customer has none", async () => {
    const svc = services();
    fake.onOrder(ORDER_ID, { body: fixture("order-phone-in-address-only.json") });
    await postWebhook(envelope("payment.received", "evt-addr", { id: ORDER_ID, payment_status: "paid" }));
    await work(svc);
    expect((await activate(EMAIL, "62 812-3456-0001")).status).toBe(200);
  });

  it("a refund after activation flags the order and the buyer keeps access (Q7)", async () => {
    const svc = services();
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    await postWebhook(envelope("payment.received", "evt-r1", { id: ORDER_ID, payment_status: "paid" }));
    await work(svc);
    const b = env.browser();
    expect(
      (await b.json("/auth/activate", "POST", { email: EMAIL, phone: "081234560001", password: PASSWORD })).status,
    ).toBe(200);
    fake.onOrder(ORDER_ID, { body: fixture("order-canceled.json") });
    await postWebhook(envelope("order.status_changed", "evt-r2", { id: ORDER_ID, status: "canceled" }));
    await work(svc);
    expect(await env.db.exec("select quarantine_reason from public.purchase_orders")).toEqual([
      { quarantine_reason: "post_payment_change" },
    ]);
    expect((await b.auth().getSession()).authenticated).toBe(true);
    expect((await env.browser().auth().login(EMAIL, PASSWORD, "Laptop")).status).toBe("ok");
    expect(await env.db.exec("select status from public.access_entitlements")).toEqual([{ status: "active" }]);
  });
});

// The real route is covered here only for what the unit tests cannot show: it is found by Next's file layout.
describe("the webhook route", () => {
  it("is reachable at /api/v1/webhooks/scalev, takes only POST, and is not the catch-all", async () => {
    services();
    const get = await dispatch(new Request(`${ORIGIN}/api/v1/webhooks/scalev`, { method: "GET" }));
    expect(get.status).toBe(405);
    const unsigned = await dispatch(new Request(`${ORIGIN}/api/v1/webhooks/scalev`, { method: "POST", body: "{}" }));
    expect(unsigned.status).toBe(401);
  });
});
