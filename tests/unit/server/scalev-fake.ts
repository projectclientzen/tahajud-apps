import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface Reply {
  status?: number;
  /** JSON body. */
  body?: unknown;
  /** Raw text body (for example a plain text 429). */
  text?: string;
  headers?: Record<string, string>;
  /** Hold the answer back, to test the client timeout. */
  delayMs?: number;
}

export interface SeenRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  authorization: string | undefined;
}

/**
 * A Scalev API that lives on 127.0.0.1 for one test file. The real client talks to it over HTTP, so the request code is
 * exercised for real, and no test ever reaches the internet or needs a Scalev key. Not a recording of Scalev: the
 * responses come from tests/fixtures/scalev/*.json, which say NEEDS_VERIFICATION.
 */
export class FakeScalev {
  private server!: Server;
  url = "";
  readonly seen: SeenRequest[] = [];
  /** Per order id: replies in order. The last one repeats. */
  private readonly orders = new Map<string, Reply[]>();
  /** Per payment_status: pages by cursor ("" = first page). */
  private readonly lists = new Map<string, Map<string, Reply>>();
  /** Reply for any request that has none scripted. */
  fallback: Reply = { status: 404, body: { code: 404, status: "error" } };

  static async start(): Promise<FakeScalev> {
    const f = new FakeScalev();
    f.server = createServer((req, res) => void f.handle(req, res));
    await new Promise<void>((r) => f.server.listen(0, "127.0.0.1", r));
    f.url = `http://127.0.0.1:${(f.server.address() as AddressInfo).port}`;
    return f;
  }

  stop(): Promise<void> {
    this.server.closeAllConnections?.();
    return new Promise((r) => this.server.close(() => r()));
  }

  reset(): void {
    this.seen.length = 0;
    this.orders.clear();
    this.lists.clear();
  }

  /** Script the replies for GET /v3/orders/:id. */
  onOrder(id: string, ...replies: Reply[]): void {
    this.orders.set(id.toLowerCase(), replies);
  }

  /** Script one page of GET /v3/orders for a payment status. */
  onList(paymentStatus: string, reply: Reply, cursor = ""): void {
    const m = this.lists.get(paymentStatus) ?? new Map<string, Reply>();
    m.set(cursor, reply);
    this.lists.set(paymentStatus, m);
  }

  count(pathPrefix: string): number {
    return this.seen.filter((r) => r.path.startsWith(pathPrefix)).length;
  }

  private async handle(req: IncomingMessage, res: import("node:http").ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://x");
    this.seen.push({
      method: req.method ?? "",
      path: url.pathname,
      query: url.searchParams,
      authorization: req.headers.authorization,
    });
    let reply: Reply = this.fallback;
    const one = /^\/v3\/orders\/([^/]+)$/.exec(url.pathname);
    if (one) {
      const queue = this.orders.get(decodeURIComponent(one[1]!).toLowerCase());
      if (queue && queue.length > 0) reply = queue.length > 1 ? queue.shift()! : queue[0]!;
    } else if (url.pathname === "/v3/orders") {
      const page = this.lists
        .get(url.searchParams.get("payment_status") ?? "")
        ?.get(url.searchParams.get("cursor") ?? "");
      reply = page ?? { status: 200, body: { code: 200, status: "success", data: { results: [], has_next: false } } };
    }
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    res.statusCode = reply.status ?? 200;
    for (const [k, v] of Object.entries(reply.headers ?? {})) res.setHeader(k, v);
    if (reply.text !== undefined) {
      res.setHeader("content-type", "text/plain");
      res.end(reply.text);
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(reply.body ?? {}));
  }
}
