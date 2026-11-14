import { isPlausibleEmail, normalizeEmail } from "@/domain/auth/email";
import { hashPhone } from "@/server/auth/crypto";
import type { ScalevOrder } from "./client";
import type { ScalevConfig } from "./config";
import { hasAllowedVariant } from "./variant-resolver";

/** Why an order is held back with no access. Same list as the CHECK on purchase_orders.quarantine_reason. */
export type QuarantineReason =
  | "unknown_variant"
  | "missing_email"
  | "missing_phone"
  | "amount_below_min"
  | "order_canceled"
  | "spam_flag"
  | "post_payment_change"
  | "needs_cs_review";

export const PAID_STATUSES: ReadonlySet<string> = new Set(["paid", "settled"]);
const DEAD_STATUSES: ReadonlySet<string> = new Set(["canceled", "closed"]);

export interface Verdict {
  /** `payment_status` of the order as read back from the API is paid or settled. */
  paid: boolean;
  /** The order was canceled or closed (whether or not it was paid). */
  dead: boolean;
  /** Null = nothing against giving access. Only meaningful when `paid`. */
  quarantine: QuarantineReason | null;
  /** Normalized email, from `customer.email` with `destination_address.email` as backup. Null if none is plausible. */
  email: string | null;
  /** Keyed hash of the normalized phone (the one function in src/server/auth/crypto.ts). Null if no phone parses. */
  phoneHash: string | null;
}

/** First plausible email: the customer's, then the delivery address's. Only ever called on the API response. */
export function pickEmail(order: ScalevOrder): string | null {
  for (const raw of [order.customerEmail, order.addressEmail]) {
    if (raw && isPlausibleEmail(raw)) return normalizeEmail(raw);
  }
  return null;
}

/** First phone that normalizes to a real number: `customer.phone`, then `destination_address.phone`. */
export function pickPhoneHash(order: ScalevOrder, pepper: string): string | null {
  for (const raw of [order.customerPhone, order.addressPhone]) {
    if (!raw) continue;
    const h = hashPhone(pepper, raw);
    if (h) return h;
  }
  return null;
}

/**
 * Decides on the order as the API returned it, never on the webhook payload. The checks run in this order and the first
 * one that fails names the reason: variant, canceled, spam, email, phone, amount. The variant comes first so an order for
 * another product of the store is never labeled by (or stored with) a customer's details. Pure: no clock, no database.
 */
export function evaluateOrder(
  order: ScalevOrder,
  config: Pick<ScalevConfig, "allowedVariants" | "minAmountIdr">,
  pepper: string,
): Verdict {
  const paid = order.paymentStatus !== null && PAID_STATUSES.has(order.paymentStatus);
  const dead = order.status !== null && DEAD_STATUSES.has(order.status);
  const email = pickEmail(order);
  const phoneHash = pickPhoneHash(order, pepper);
  let quarantine: QuarantineReason | null = null;
  if (!hasAllowedVariant(order.orderlines, config.allowedVariants)) quarantine = "unknown_variant";
  else if (dead) quarantine = "order_canceled";
  else if (order.isSpam) quarantine = "spam_flag";
  else if (!email) quarantine = "missing_email";
  else if (!phoneHash) quarantine = "missing_phone";
  // With a minimum set, an order that does not say how much was paid is treated as below it. Safe side.
  else if (config.minAmountIdr !== null && (order.netAmount === null || order.netAmount < config.minAmountIdr))
    quarantine = "amount_below_min";
  return { paid, dead, quarantine, email, phoneHash };
}
