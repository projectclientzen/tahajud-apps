import { ORDER_ID_RE } from "./types";

/**
 * Why a Scalev call failed, in the terms the worker decides on. The response body is never kept: it can hold
 * customer data, and the API key is never part of any message.
 *   auth         401 or 403. The key is wrong or lacks a scope. Trying again cannot help (SCALEV-12).
 *   not_found    404. A new order is sometimes not readable for a moment.
 *   rate_limited 429, plain text or JSON. `retryAfterSeconds` comes from the rate limit headers when they parse.
 *   server       5xx.
 *   network      timeout, connection refused, TLS error.
 *   bad_response 2xx but not an order we can read. NEEDS_VERIFICATION: the exact response shape is not confirmed.
 */
export type ScalevErrorKind = "auth" | "not_found" | "rate_limited" | "server" | "network" | "bad_response";

export class ScalevApiError extends Error {
  constructor(
    readonly kind: ScalevErrorKind,
    message: string,
    readonly status: number | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ScalevApiError";
  }
  /** Worth trying again later. `auth` and `bad_request` are not. */
  get retryable(): boolean {
    return this.kind !== "auth";
  }
}

export interface ScalevOrderline {
  /** Numeric variant id (`orderlines[].variant`) as a string, or null. */
  variantId: string | null;
  sku: string | null;
  quantity: number;
}

/** The few fields of an order this app uses. Everything else in the response is dropped here, on purpose. */
export interface ScalevOrder {
  id: string;
  orderNumber: string | null;
  status: string | null;
  paymentStatus: string | null;
  isSpam: boolean;
  /** `net_revenue` in IDR, or null when absent. */
  netAmount: number | null;
  currency: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  addressEmail: string | null;
  addressPhone: string | null;
  orderlines: ScalevOrderline[];
  /** ISO time the order was created, when Scalev says. */
  createdAt: string | null;
  /**
   * ISO time the order was paid. NEEDS_VERIFICATION: the field name is not in the Scalev docs we have, so the parser
   * tries `paid_time`, `payment_time` and `paid_at`. The sweep window uses this, and falls back to `createdAt`.
   */
  paidAt: string | null;
}

export interface ScalevOrderPage {
  orders: ScalevOrder[];
  nextCursor: string | null;
}

/** What the handlers need. The real client below, or a fake in tests. */
export interface ScalevApi {
  getOrder(orderId: string): Promise<ScalevOrder>;
  /** Newest first. `cursor` is whatever the previous page returned. */
  listOrders(opts: {
    storeId: string;
    paymentStatus: "paid" | "settled";
    cursor?: string | null;
    pageSize?: number;
  }): Promise<ScalevOrderPage>;
}

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : null;
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
}

/**
 * NEEDS_VERIFICATION: written from dev.scalev.com (13 Nov 2026), not from a real response. Accepts the order bare or
 * wrapped as `{ data: order }`. Returns null when it does not look like an order (no id, no payment_status).
 */
export function parseOrder(body: unknown): ScalevOrder | null {
  const top = obj(body);
  if (!top) return null;
  const o =
    obj(top.data) && ("payment_status" in (top.data as object) || "id" in (top.data as object)) ? obj(top.data)! : top;
  return orderFrom(o);
}

function orderFrom(o: Record<string, unknown>): ScalevOrder | null {
  const id = str(o.id);
  if (!id || !ORDER_ID_RE.test(id) || !("payment_status" in o)) return null;
  const customer = obj(o.customer);
  const address = obj(o.destination_address);
  const lines = Array.isArray(o.orderlines) ? o.orderlines : [];
  return {
    id: id.toLowerCase(),
    orderNumber: str(o.order_id),
    status: str(o.status),
    paymentStatus: str(o.payment_status),
    isSpam: o.is_probably_spam === true,
    netAmount: num(o.net_revenue),
    currency: str(o.currency),
    customerName: str(customer?.name),
    customerEmail: str(customer?.email),
    customerPhone: str(customer?.phone),
    addressEmail: str(address?.email),
    addressPhone: str(address?.phone),
    orderlines: lines.flatMap((l) => {
      const line = obj(l);
      if (!line) return [];
      return [{ variantId: str(line.variant), sku: str(line.variant_sku), quantity: num(line.quantity) ?? 1 }];
    }),
    createdAt: str(o.created_at) ?? str(o.created_time),
    paidAt: str(o.paid_time) ?? str(o.payment_time) ?? str(o.paid_at),
  };
}

/** NEEDS_VERIFICATION: the list response shape. Looks for the array in `data.results`, `data` or `results`. */
export function parseOrderPage(body: unknown): ScalevOrderPage | null {
  const top = obj(body);
  if (!top) return null;
  const data = top.data;
  const d = obj(data);
  const list = Array.isArray(data)
    ? data
    : Array.isArray(d?.results)
      ? d.results
      : Array.isArray(top.results)
        ? top.results
        : null;
  if (!list) return null;
  const orders = list.flatMap((x) => {
    const o = obj(x);
    const parsed = o ? orderFrom(o) : null;
    return parsed ? [parsed] : [];
  });
  const cursor = str(d?.next_cursor) ?? str(d?.cursor) ?? str(top.next_cursor) ?? str(top.cursor);
  return { orders, nextCursor: d?.has_next === false || top.has_next === false ? null : cursor };
}

/** Seconds to wait from `X-Ratelimit-Reset`: either seconds from now, or an epoch timestamp. Anything else is null. */
export function retryAfterFrom(headers: Headers, nowMs: number): number | null {
  const raw = headers.get("retry-after") ?? headers.get("x-ratelimit-reset");
  if (!raw || !/^\d+(\.\d+)?$/.test(raw.trim())) return null;
  const n = Number(raw);
  const seconds = n > 1_000_000_000 ? n - nowMs / 1000 : n;
  return Math.min(3600, Math.max(1, Math.ceil(seconds)));
}

export class ScalevClient implements ScalevApi {
  private readonly base: string;
  private readonly key: string;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(opts: ClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.key = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  async getOrder(orderId: string): Promise<ScalevOrder> {
    // The id came from a webhook body. It goes into a path, so only a UUID is allowed through.
    if (!ORDER_ID_RE.test(orderId)) throw new ScalevApiError("bad_response", "Order id is not a UUID", null);
    const body = await this.request(`/v3/orders/${orderId}`);
    const order = parseOrder(body);
    if (!order) throw new ScalevApiError("bad_response", "Response is not an order we can read", 200);
    if (order.id !== orderId.toLowerCase())
      throw new ScalevApiError("bad_response", "Response is for another order", 200);
    return order;
  }

  async listOrders(opts: {
    storeId: string;
    paymentStatus: "paid" | "settled";
    cursor?: string | null;
    pageSize?: number;
  }): Promise<ScalevOrderPage> {
    const q = new URLSearchParams({
      store_id: opts.storeId,
      payment_status: opts.paymentStatus,
      page_size: String(opts.pageSize ?? 25),
    });
    if (opts.cursor) q.set("cursor", opts.cursor);
    const page = parseOrderPage(await this.request(`/v3/orders?${q.toString()}`));
    if (!page) throw new ScalevApiError("bad_response", "Response is not an order list we can read", 200);
    return page;
  }

  private async request(path: string): Promise<unknown> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.doFetch(`${this.base}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json" },
        signal: ctl.signal,
        redirect: "error",
      });
    } catch (e) {
      const timedOut = ctl.signal.aborted;
      // The message never includes the URL or any header: it ends up in job logs and in the admin screen.
      throw new ScalevApiError(
        "network",
        timedOut ? `Timeout after ${this.timeoutMs} ms` : `Network error (${e instanceof Error ? e.name : "unknown"})`,
      );
    } finally {
      clearTimeout(timer);
    }
    const status = res.status;
    if (status === 401 || status === 403) {
      await res.body?.cancel().catch(() => undefined);
      throw new ScalevApiError("auth", `Scalev refused the API key (${status})`, status);
    }
    if (status === 404) {
      await res.body?.cancel().catch(() => undefined);
      throw new ScalevApiError("not_found", "Order not found (404)", status);
    }
    if (status === 429) {
      await res.body?.cancel().catch(() => undefined); // may be plain text, not JSON
      throw new ScalevApiError(
        "rate_limited",
        "Scalev rate limit (429)",
        status,
        retryAfterFrom(res.headers, Date.now()),
      );
    }
    if (status >= 500) {
      await res.body?.cancel().catch(() => undefined);
      throw new ScalevApiError("server", `Scalev server error (${status})`, status);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new ScalevApiError("bad_response", `Unexpected status ${status}`, status);
    }
    try {
      return await res.json();
    } catch {
      throw new ScalevApiError("bad_response", "Response is not JSON", status);
    }
  }
}
