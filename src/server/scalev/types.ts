import { z } from "zod";

/** Events that make the worker look at an order. Everything else is stored for audit and ignored. */
export const TRIGGER_EVENTS: ReadonlySet<string> = new Set([
  "payment.received",
  "payment.failed",
  "order.status_changed",
  "order.deleted",
]);

/** Scalev's own check that the endpoint answers. Answered 200 with no effect. */
export const TEST_EVENT = "business.test_event";

/** The envelope Scalev sends. Only these four keys are read. `data` is untrusted and used only to find the order. */
export const WebhookEnvelope = z.object({
  event: z.string().min(1).max(100),
  unique_id: z.string().min(1).max(200),
  timestamp: z.union([z.string().min(1).max(64), z.number()]),
  data: z.record(z.string(), z.unknown()),
});
export type WebhookEnvelope = z.infer<typeof WebhookEnvelope>;

/** Order ids are UUIDv7 and go into a URL path. Anything else is refused before it can reach the API client. */
export const ORDER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
