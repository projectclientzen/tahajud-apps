import { describe, expect, it } from "vitest";
import { K, mergeSmallGroups, suppressCount } from "@/server/admin/rules/k-anon";
import { hotp, totp, verifyTotp, stepOf, base32Decode, base32Encode } from "@/server/admin/rules/totp";
import { ADMIN_ROLES, PERMISSIONS, auditTypesFor, can, navFor } from "@/server/admin/rules/permissions";
import { checkTemplateText } from "@/server/admin/rules/text";
import { shapeAggregates } from "@/server/admin/aggregates";

// RFC 6238 Appendix B, SHA-1, secret "12345678901234567890". The RFC lists 8 digits; the 6 digit code is the last 6.
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: [number, string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("TOTP follows RFC 6238", () => {
  it.each(RFC_VECTORS)("T=%i gives the RFC code (last 6 digits)", (t, eight) => {
    expect(totp(RFC_SECRET, t * 1000)).toBe(eight.slice(-6));
  });

  it("HOTP matches RFC 4226 Appendix D", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, i) => expect(hotp(RFC_SECRET, i)).toBe(code));
  });

  it("accepts one step of clock drift each way, not two, and never the same step twice", () => {
    const now = 1_700_000_000_000;
    const step = stepOf(now);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step), now, 0)).toBe(step);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now, 0)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), now, 0)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), now, 0)).toBeNull();
    expect(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step), now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", now, 0)).toBeNull();
  });

  it("base32 round trips (the secret an authenticator app scans)", () => {
    const secret = Buffer.from("00112233445566778899", "hex");
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });
});

describe("the 20 user rule (PRIV-01)", () => {
  it("K is 20", () => expect(K).toBe(20));

  it("a single count below 20 is hidden, 20 is shown", () => {
    expect(suppressCount(19)).toBeNull();
    expect(suppressCount(20)).toBe(20);
  });

  it("a whole set below 20 shows nothing, not even the total", () => {
    expect(mergeSmallGroups([{ key: "a", n: 10 }, { key: "b", n: 9 }])).toEqual({ hidden: true, total: null, groups: [] });
  });

  it("small groups are merged so every shown number is at least 20 and the total stays true", () => {
    const r = mergeSmallGroups([
      { key: "big", n: 100 },
      { key: "s1", n: 5 },
      { key: "s2", n: 7 },
      { key: "s3", n: 9 },
    ]);
    expect(r.total).toBe(121);
    expect(r.groups.reduce((s, g) => s + g.n, 0)).toBe(121);
    for (const g of r.groups) expect(g.n).toBeGreaterThanOrEqual(20);
    expect(r.groups.find((g) => g.key === "other")?.merged).toEqual(["s1", "s2", "s3"]);
  });

  it("when the small groups together are still below 20, the smallest big group is folded in so the bucket cannot be subtracted out", () => {
    const r = mergeSmallGroups([
      { key: "a", n: 25 },
      { key: "b", n: 40 },
      { key: "tiny", n: 3 },
    ]);
    for (const g of r.groups) expect(g.n).toBeGreaterThanOrEqual(20);
    expect(r.groups.reduce((s, g) => s + g.n, 0)).toBe(68);
    expect(r.groups.find((g) => g.key === "other")?.merged).toEqual(["tiny", "a"]);
  });

  it("shapeAggregates passes every group through the rule", () => {
    const shown = shapeAggregates({
      entitlements: [{ key: "active", n: 50 }, { key: "revoked", n: 2 }],
      accounts: 10,
      onboarding: [{ key: "done", n: 8 }, { key: "not_done", n: 2 }],
      levels: [],
      active_users: 19,
      recent_activity: [{ key: "7_days", n: 4 }, { key: "30_days", n: 60 }],
      completed_nights: [],
      notifications_7_days: [{ type: "bedtime", status: "sent", n: 3 }],
    });
    expect(shown.accounts).toBeNull();
    expect(shown.active_users).toBeNull();
    expect(shown.onboarding.hidden).toBe(true);
    expect(shown.recent_activity).toEqual([{ key: "7_days", n: null }, { key: "30_days", n: 60 }]);
    expect(shown.notifications_7_days.hidden).toBe(true);
    for (const g of shown.entitlements.groups) expect(g.n).toBeGreaterThanOrEqual(20);
  });
});

describe("permission table", () => {
  it("every permission lists only known roles, and super_admin is in all of them", () => {
    for (const [perm, roles] of Object.entries(PERMISSIONS)) {
      for (const r of roles) expect(ADMIN_ROLES as readonly string[], perm).toContain(r);
      expect(roles as readonly string[], perm).toContain("super_admin");
    }
  });

  it("only super_admin manages roles and staff; the reporting role sees aggregates and nothing else", () => {
    expect(can(["support_admin"], "staff.manage")).toBe(false);
    expect(can(["support_admin"], "roles.manage")).toBe(false);
    expect(can(["super_admin"], "staff.manage")).toBe(true);
    for (const perm of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      expect(can(["reporting_admin"], perm), perm).toBe(perm === "dashboard.aggregates");
    }
  });

  it("phone checks and reset links are for super_admin and support only", () => {
    for (const perm of ["support.phone", "support.reset_link"] as const) {
      expect([...PERMISSIONS[perm]].sort()).toEqual(["super_admin", "support_admin"]);
    }
    expect(can(["content_admin"], "support.phone")).toBe(false);
  });

  it("the menu hides what a role cannot open, and the audit view is scoped per role", () => {
    expect(navFor(["content_admin"]).map((n) => n.href)).not.toContain("/admin/staff");
    expect(navFor(["support_admin"]).map((n) => n.href)).toContain("/admin/purchases");
    expect(auditTypesFor(["super_admin"])).toBeNull();
    expect(auditTypesFor(["support_admin"])).toEqual(expect.arrayContaining(["order", "entitlement", "user"]));
    expect(auditTypesFor(["support_admin"])).not.toContain("user_role");
    expect(auditTypesFor(["reporting_admin"])).toEqual([]);
  });
});

describe("text rules for the CMS", () => {
  it("refuses Arabic, HTML, unknown variables and empty text", () => {
    expect(checkTemplateText("بسم الله", 60)).toBe("arabic_not_allowed");
    expect(checkTemplateText("<b>hai</b>", 60)).toBe("html_not_allowed");
    expect(checkTemplateText("Halo {email}", 60)).toBe("unknown_variable");
    expect(checkTemplateText("   ", 60)).toBe("empty");
    expect(checkTemplateText("Halo {nama}, level {level}", 60)).toBeNull();
  });
});
