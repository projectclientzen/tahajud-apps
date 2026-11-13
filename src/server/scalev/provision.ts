import { one, type Db } from "@/server/db";
import type { ScalevOrder } from "./client";
import type { Verdict } from "./verify";

export interface ApplyResult {
  order_id: string;
  entitlement_created: boolean;
  entitlement_exists: boolean;
  quarantine_reason: string | null;
  skipped?: string;
}

export interface OrderState {
  known: boolean;
  hasEntitlement: boolean;
  verifiedVia: string | null;
}

/** What we already hold about an order. Decides what a "not paid" or "canceled" reading means. */
export async function orderState(db: Db, scalevOrderId: string): Promise<OrderState> {
  const rows = await db.asService((q) =>
    q.query<{ verified_via: string | null; has_ent: boolean }>(
      `select o.verified_via,
              exists (select 1 from public.access_entitlements e where e.purchase_order_id = o.id and e.entitlement_type = 'lifetime') as has_ent
       from public.purchase_orders o where o.scalev_order_id = $1`,
      [scalevOrderId],
    ),
  );
  const r = rows[0];
  return { known: !!r, hasEntitlement: r?.has_ent === true, verifiedVia: r?.verified_via ?? null };
}

/**
 * Writes the outcome of one verified order in one database transaction (scalev_apply_order). An order for a product that
 * is not ours is stored without email, phone and name: we have no business holding them.
 */
export function applyOrder(
  db: Db,
  order: ScalevOrder,
  verdict: Verdict,
  eventId: string | null,
  now: Date,
): Promise<ApplyResult> {
  const foreign = verdict.quarantine === "unknown_variant";
  const items = order.orderlines.map((l) => ({ variant_id: l.variantId, variant_sku: l.sku, quantity: l.quantity }));
  return db.asService((q) =>
    one<ApplyResult>(
      q,
      "app_private.scalev_apply_order($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::uuid, $13::timestamptz)",
      [
        order.id,
        order.orderNumber,
        foreign ? null : verdict.email,
        foreign ? null : verdict.phoneHash,
        foreign ? null : order.customerName,
        order.paymentStatus,
        order.status,
        order.netAmount,
        order.currency,
        verdict.quarantine,
        JSON.stringify(items),
        eventId,
        now.toISOString(),
      ],
    ),
  );
}

/** An order we gave access to is gone from Scalev. Flag it for an admin; access is not touched. */
export function flagOrder(
  db: Db,
  scalevOrderId: string,
  reason: string,
  eventId: string | null,
  now: Date,
): Promise<boolean> {
  return db.asService((q) =>
    one<boolean>(q, "app_private.scalev_flag_order($1, $2, $3::uuid, $4::timestamptz)", [
      scalevOrderId,
      reason,
      eventId,
      now.toISOString(),
    ]),
  );
}
