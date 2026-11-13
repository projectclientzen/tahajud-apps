import type { AllowedVariants } from "./config";
import type { ScalevOrderline } from "./client";

/**
 * Does an orderline sell the product that grants access? `SCALEV_ALLOWED_VARIANT_IDS` can hold numeric variant ids
 * (matched against `orderlines[].variant`) and SKUs (matched against `orderlines[].variant_sku`, ignoring case).
 * Scalev's order response has no `variant_unique_id`, so there is nothing to resolve over the network: the number and
 * the SKU are the join keys (SCALEV-AUTH-PLAN §1 row 3a, brief X2-A). Empty allowlist: nothing matches.
 */
export function lineGrantsAccess(line: ScalevOrderline, allowed: AllowedVariants): boolean {
  if (line.variantId !== null && allowed.ids.has(String(Number(line.variantId)))) return true;
  if (line.sku !== null && allowed.skus.has(line.sku.trim().toLowerCase())) return true;
  return false;
}

export function hasAllowedVariant(lines: readonly ScalevOrderline[], allowed: AllowedVariants): boolean {
  return lines.some((l) => lineGrantsAccess(l, allowed));
}

export const allowlistIsEmpty = (allowed: AllowedVariants): boolean =>
  allowed.ids.size === 0 && allowed.skus.size === 0;
