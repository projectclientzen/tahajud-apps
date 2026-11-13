import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ScalevApiError, ScalevClient, parseOrder, parseOrderPage, retryAfterFrom } from "@/server/scalev/client";
import { FakeScalev } from "./scalev-fake";
import { ORDER_ID, fixture } from "./scalev-harness";

let fake: FakeScalev;
const KEY = "sk_test_this_key_must_never_appear_in_an_error";
beforeAll(async () => {
  fake = await FakeScalev.start();
});
afterAll(async () => fake.stop());
beforeEach(() => fake.reset());

const client = (over: Partial<ConstructorParameters<typeof ScalevClient>[0]> = {}) =>
  new ScalevClient({ baseUrl: fake.url, apiKey: KEY, ...over });

async function failure(p: Promise<unknown>): Promise<ScalevApiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ScalevApiError) return e;
    throw e;
  }
  throw new Error("expected a ScalevApiError");
}

describe("reading an order", () => {
  it("sends the key as a bearer token to /v3/orders/{id} and reads the fields we use", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json") });
    const o = await client().getOrder(ORDER_ID);
    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0]).toMatchObject({
      method: "GET",
      path: `/v3/orders/${ORDER_ID}`,
      authorization: `Bearer ${KEY}`,
    });
    expect(o).toMatchObject({
      id: ORDER_ID,
      orderNumber: "ORD-DEMO-0001",
      status: "confirmed",
      paymentStatus: "paid",
      isSpam: false,
      netAmount: 99000,
      customerEmail: "Pembeli.Demo@Example.test",
      customerPhone: "0812-3456-0001",
      addressPhone: "+62 812 3456 0001",
      orderlines: [{ variantId: "5550001", sku: "TT-LIFETIME", quantity: 1 }],
    });
  });

  it("accepts the order bare or wrapped in data (the wrapper is NEEDS_VERIFICATION)", () => {
    const wrapped = fixture<{ data: Record<string, unknown> }>("order-paid.json");
    expect(parseOrder(wrapped)?.id).toBe(ORDER_ID);
    expect(parseOrder(wrapped.data)?.id).toBe(ORDER_ID);
    expect(parseOrder({ data: { nothing: true } })).toBeNull();
    expect(parseOrder("x")).toBeNull();
    expect(parseOrder({ id: "not-a-uuid", payment_status: "paid" })).toBeNull();
    expect(parseOrder({ id: ORDER_ID })).toBeNull();
  });

  it("an id that is not a UUID never reaches the network (no path tricks)", async () => {
    for (const bad of ["../v3/stores", "abc", `${ORDER_ID}/../x`, `${ORDER_ID}?x=1`, ""]) {
      const e = await failure(client().getOrder(bad));
      expect(e.kind).toBe("bad_response");
    }
    expect(fake.seen).toHaveLength(0);
  });

  it("refuses an answer that is for another order", async () => {
    fake.onOrder(ORDER_ID, {
      body: {
        ...fixture<Record<string, unknown>>("order-paid.json"),
        data: { ...fixture<{ data: object }>("order-paid.json").data, id: "0192f3a0-7b1c-7d2e-8a41-5c6d7e8f9a99" },
      },
    });
    expect((await failure(client().getOrder(ORDER_ID))).kind).toBe("bad_response");
  });
});

describe("failures are named, and never carry the key or the body", () => {
  it("401 and 403 are auth errors and not retryable (SCALEV-12)", async () => {
    for (const status of [401, 403]) {
      fake.onOrder(ORDER_ID, { status, body: { detail: `bad key ${KEY}` } });
      const e = await failure(client().getOrder(ORDER_ID));
      expect(e).toMatchObject({ kind: "auth", status, retryable: false });
      expect(e.message).not.toContain(KEY);
      expect(e.message).not.toContain("bad key");
    }
  });

  it("404 is not_found, 5xx is server, both retryable", async () => {
    fake.onOrder(ORDER_ID, { status: 404 });
    expect(await failure(client().getOrder(ORDER_ID))).toMatchObject({ kind: "not_found", retryable: true });
    fake.onOrder(ORDER_ID, { status: 503, text: "down" });
    expect(await failure(client().getOrder(ORDER_ID))).toMatchObject({ kind: "server", status: 503 });
  });

  it("429 can be plain text; the wait comes from the rate limit headers", async () => {
    fake.onOrder(ORDER_ID, { status: 429, text: "Too many requests", headers: { "x-ratelimit-reset": "17" } });
    expect(await failure(client().getOrder(ORDER_ID))).toMatchObject({ kind: "rate_limited", retryAfterSeconds: 17 });
    fake.onOrder(ORDER_ID, { status: 429, text: "Too many requests" });
    expect(await failure(client().getOrder(ORDER_ID))).toMatchObject({ kind: "rate_limited", retryAfterSeconds: null });
  });

  it("reads the wait as seconds, as an epoch time, or not at all, and caps it at an hour", () => {
    const now = Date.parse("2026-11-13T08:00:00Z");
    const h = (v: string, name = "x-ratelimit-reset") => new Headers({ [name]: v });
    expect(retryAfterFrom(h("30"), now)).toBe(30);
    expect(retryAfterFrom(h("120", "retry-after"), now)).toBe(120);
    expect(retryAfterFrom(h(String(now / 1000 + 45)), now)).toBe(45);
    expect(retryAfterFrom(h("999999"), now)).toBe(3600);
    expect(retryAfterFrom(h("0"), now)).toBe(1);
    expect(retryAfterFrom(h("soon"), now)).toBeNull();
    expect(retryAfterFrom(new Headers(), now)).toBeNull();
  });

  it("a timeout and a refused connection are network errors", async () => {
    fake.onOrder(ORDER_ID, { body: fixture("order-paid.json"), delayMs: 400 });
    const t = await failure(client({ timeoutMs: 50 }).getOrder(ORDER_ID));
    expect(t).toMatchObject({ kind: "network" });
    expect(t.message).toMatch(/Timeout/);
    const closed = await failure(
      new ScalevClient({ baseUrl: "http://127.0.0.1:1", apiKey: KEY, timeoutMs: 500 }).getOrder(ORDER_ID),
    );
    expect(closed.kind).toBe("network");
    expect(closed.message).not.toContain("127.0.0.1");
    expect(closed.message).not.toContain(KEY);
  });

  it("a 200 that is not an order, or not JSON, is bad_response", async () => {
    fake.onOrder(ORDER_ID, { body: { hello: "world" } });
    expect((await failure(client().getOrder(ORDER_ID))).kind).toBe("bad_response");
    fake.onOrder(ORDER_ID, { text: "<html>proxy error</html>" });
    expect((await failure(client().getOrder(ORDER_ID))).kind).toBe("bad_response");
  });

  it("does not follow a redirect (the key would go with it)", async () => {
    fake.onOrder(ORDER_ID, { status: 302, headers: { location: "http://127.0.0.1:1/steal" } });
    expect((await failure(client().getOrder(ORDER_ID))).kind).toBe("network");
  });
});

describe("listing orders (NEEDS_VERIFICATION)", () => {
  it("asks for the store, the payment status and 25 per page, and passes the cursor on", async () => {
    fake.onList("paid", { body: fixture("order-list-page.json") });
    const page = await client().listOrders({ storeId: "2785", paymentStatus: "paid" });
    expect(page.orders.map((o) => o.id)).toEqual([ORDER_ID]);
    expect(page.nextCursor).toBeNull();
    expect(Object.fromEntries(fake.seen[0]!.query)).toEqual({
      store_id: "2785",
      payment_status: "paid",
      page_size: "25",
    });
    await client().listOrders({ storeId: "2785", paymentStatus: "settled", cursor: "abc" });
    expect(fake.seen[1]!.query.get("cursor")).toBe("abc");
  });

  it("finds the list in data.results, data, or results, and says bad_response when there is none", () => {
    const order = fixture<{ data: Record<string, unknown> }>("order-paid.json").data;
    expect(parseOrderPage({ data: { results: [order], next_cursor: "n" } })).toMatchObject({ nextCursor: "n" });
    expect(parseOrderPage({ data: [order] })?.orders).toHaveLength(1);
    expect(parseOrderPage({ results: [order], has_next: false, next_cursor: "n" })?.nextCursor).toBeNull();
    expect(parseOrderPage({ data: { rows: [] } })).toBeNull();
    expect(parseOrderPage(null)).toBeNull();
  });
});
