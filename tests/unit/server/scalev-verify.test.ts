import { describe, expect, it } from "vitest";
import { hashPhone } from "@/server/auth/crypto";
import { parseOrder, type ScalevOrder } from "@/server/scalev/client";
import { parseAllowedVariants } from "@/server/scalev/config";
import { evaluateOrder, pickEmail, pickPhoneHash } from "@/server/scalev/verify";
import { lineGrantsAccess } from "@/server/scalev/variant-resolver";
import { fixture } from "./scalev-harness";

const PEPPER = "test-pepper-test-pepper-test-pepper-0123456789";
const cfg = (variants = "5550001", min: number | null = null) => ({
  allowedVariants: parseAllowedVariants(variants),
  minAmountIdr: min,
});
const order = (name: string, patch: Partial<ScalevOrder> = {}): ScalevOrder => ({
  ...parseOrder(fixture(name))!,
  ...patch,
});

describe("allowed variants: numeric ids and SKUs", () => {
  it("parses digits as ids and everything else as SKUs, ignoring case and blanks", () => {
    const a = parseAllowedVariants(" 5550001, tt-lifetime ,,0012, SKU_B ");
    expect([...a.ids].sort()).toEqual(["12", "5550001"]);
    expect([...a.skus].sort()).toEqual(["sku_b", "tt-lifetime"]);
    expect(parseAllowedVariants(undefined)).toEqual({ ids: new Set(), skus: new Set() });
  });

  it("an orderline matches by id, by SKU, or both; a foreign line matches nothing", () => {
    const line = { variantId: "5550001", sku: "TT-LIFETIME", quantity: 1 };
    expect(lineGrantsAccess(line, parseAllowedVariants("5550001"))).toBe(true);
    expect(lineGrantsAccess(line, parseAllowedVariants("tt-lifetime"))).toBe(true);
    expect(lineGrantsAccess(line, parseAllowedVariants("5550001,TT-LIFETIME"))).toBe(true);
    expect(
      lineGrantsAccess({ variantId: "5550001", sku: null, quantity: 1 }, parseAllowedVariants("TT-LIFETIME")),
    ).toBe(false);
    expect(
      lineGrantsAccess(
        { variantId: "9990009", sku: "OTHER", quantity: 1 },
        parseAllowedVariants("5550001,TT-LIFETIME"),
      ),
    ).toBe(false);
    expect(lineGrantsAccess(line, parseAllowedVariants(""))).toBe(false);
    // a SKU entry never matches a numeric id by accident, and a number never matches a SKU that is only digits... of another kind
    expect(lineGrantsAccess({ variantId: "55", sku: null, quantity: 1 }, parseAllowedVariants("5550001"))).toBe(false);
  });
});

describe("evaluating an order read from the API", () => {
  it("a paid order for our variant with email and phone has nothing against it", () => {
    const v = evaluateOrder(order("order-paid.json"), cfg(), PEPPER);
    expect(v).toEqual({
      paid: true,
      dead: false,
      quarantine: null,
      email: "pembeli.demo@example.test",
      phoneHash: hashPhone(PEPPER, "081234560001"),
    });
  });

  it("settled counts as paid; unpaid and conflict do not", () => {
    expect(evaluateOrder(order("order-settled.json"), cfg(), PEPPER).paid).toBe(true);
    expect(evaluateOrder(order("order-unpaid.json"), cfg(), PEPPER).paid).toBe(false);
    expect(evaluateOrder(order("order-paid.json", { paymentStatus: "conflict" }), cfg(), PEPPER).paid).toBe(false);
    expect(evaluateOrder(order("order-paid.json", { paymentStatus: null }), cfg(), PEPPER).paid).toBe(false);
  });

  it.each([
    ["order-foreign-variant.json", "unknown_variant"],
    ["order-canceled.json", "order_canceled"],
    ["order-spam.json", "spam_flag"],
    ["order-no-email.json", "missing_email"],
    ["order-no-phone.json", "missing_phone"],
    ["order-low-amount.json", "amount_below_min"],
  ])("%s is held back as %s", (file, reason) => {
    expect(evaluateOrder(order(file), cfg("5550001", 50000), PEPPER).quarantine).toBe(reason);
  });

  it("the amount check only exists when a minimum is set, and an unknown amount counts as below it", () => {
    expect(evaluateOrder(order("order-low-amount.json"), cfg("5550001", null), PEPPER).quarantine).toBeNull();
    expect(evaluateOrder(order("order-paid.json", { netAmount: null }), cfg("5550001", 50000), PEPPER).quarantine).toBe(
      "amount_below_min",
    );
    expect(
      evaluateOrder(order("order-paid.json", { netAmount: 50000 }), cfg("5550001", 50000), PEPPER).quarantine,
    ).toBeNull();
  });

  it("an empty allowlist holds every order back", () => {
    expect(evaluateOrder(order("order-paid.json"), cfg(""), PEPPER).quarantine).toBe("unknown_variant");
  });

  it("the variant is checked first, so a foreign canceled order is still just 'unknown_variant'", () => {
    expect(
      evaluateOrder(order("order-foreign-variant.json", { status: "canceled", isSpam: true }), cfg(), PEPPER)
        .quarantine,
    ).toBe("unknown_variant");
  });

  it("closed counts as canceled", () => {
    expect(evaluateOrder(order("order-paid.json", { status: "closed" }), cfg(), PEPPER)).toMatchObject({
      dead: true,
      quarantine: "order_canceled",
    });
  });
});

describe("email and phone come from the API response only", () => {
  it("email: customer first, address as backup, normalized; junk is not an email", () => {
    expect(pickEmail(order("order-paid.json"))).toBe("pembeli.demo@example.test");
    expect(pickEmail(order("order-paid.json", { customerEmail: null, addressEmail: " Alamat@Example.TEST " }))).toBe(
      "alamat@example.test",
    );
    expect(pickEmail(order("order-paid.json", { customerEmail: "not an email", addressEmail: null }))).toBeNull();
    expect(pickEmail(order("order-no-email.json"))).toBeNull();
  });

  it("phone: 08, 62 and +62 forms give the same hash, as the activation form computes it", () => {
    const want = hashPhone(PEPPER, "081234560001");
    for (const raw of [
      "081234560001",
      "0812-3456-0001",
      "+62 812 3456 0001",
      "62 812-3456-0001",
      "(0812) 3456 0001",
      "81234560001",
    ]) {
      expect(pickPhoneHash(order("order-paid.json", { customerPhone: raw, addressPhone: null }), PEPPER), raw).toBe(
        want,
      );
    }
  });

  it("phone: customer first, delivery address as backup, junk skipped", () => {
    const want = hashPhone(PEPPER, "081234560001");
    expect(pickPhoneHash(order("order-phone-in-address-only.json"), PEPPER)).toBe(want);
    expect(
      pickPhoneHash(order("order-paid.json", { customerPhone: "tidak ada", addressPhone: "081234560001" }), PEPPER),
    ).toBe(want);
    expect(pickPhoneHash(order("order-no-phone.json"), PEPPER)).toBeNull();
    expect(pickPhoneHash(order("order-paid.json", { customerPhone: "abc", addressPhone: "123" }), PEPPER)).toBeNull();
  });

  it("a different pepper gives a different hash (the proof is keyed)", () => {
    const o = order("order-paid.json");
    expect(pickPhoneHash(o, PEPPER)).not.toBe(pickPhoneHash(o, PEPPER + "x"));
  });
});
