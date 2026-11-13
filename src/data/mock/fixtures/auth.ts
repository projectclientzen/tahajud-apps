// DEMO DATA: bukan data asli
import { PROVISIONAL_AUTH } from "@/domain/config/provisional";
import type { AuthState, EntitlementStatus } from "../auth";

/** Reserved `.test` domain: these addresses can never belong to a real person. */
export const DEMO_EMAILS = {
  active: "demo@ngajigaes.test",
  pending: "pending@ngajigaes.test",
  suspended: "suspended@ngajigaes.test",
  /** Has an account and a password, but no entitlement. */
  noAccess: "noaccess@ngajigaes.test",
  /** Paid demo order, no account yet: use it to try activation. */
  newBuyer: "baru@ngajigaes.test",
} as const;

/**
 * DEMO ONLY. The one password every demo account has. It exists only in mock mode, it is never sent to a server and
 * never saved in a database. Real accounts have no shared or default password (CLAUDE.md auth rules).
 */
export const DEMO_PASSWORD = "demo-password-aman";
/** SHA-256 of `tt-demo-only:` + DEMO_PASSWORD, so the sync scenario builder needs no crypto. */
const DEMO_PASSWORD_HASH = "15d3fd5b62d100974ddb9f8965cdcb92689e74473866afb01a245d049de5d1e9";

/** DEMO phone numbers (not real), as typed by a buyer. Stored normalized in the demo orders. */
export const DEMO_PHONES = {
  active: "0812-0000-0001",
  newBuyer: "0812-0000-0002",
} as const;
const DEMO_PHONES_NORMALIZED = { active: "6281200000001", newBuyer: "6281200000002" } as const;

export const DEMO_ENTITLEMENTS: Record<string, EntitlementStatus> = {
  [DEMO_EMAILS.active]: "active",
  [DEMO_EMAILS.pending]: "pending_verification",
  [DEMO_EMAILS.suspended]: "suspended",
  [DEMO_EMAILS.newBuyer]: "active",
};

export const AUTH_SCENARIOS = [
  "logged_out",
  "logged_in",
  "purchase_pending",
  "no_active_access",
  "session_expired",
  "device_limit",
] as const;
export type AuthScenarioName = (typeof AUTH_SCENARIOS)[number];

const DAY = 86_400_000;

export function buildAuthScenario(name: AuthScenarioName, now: number): AuthState {
  const account = (email: string) => ({ userId: userIdFor(email), passwordHash: DEMO_PASSWORD_HASH });
  const base: AuthState = {
    schemaVersion: 2,
    scenario: name,
    orders: {
      [DEMO_EMAILS.active]: { phone: DEMO_PHONES_NORMALIZED.active },
      [DEMO_EMAILS.newBuyer]: { phone: DEMO_PHONES_NORMALIZED.newBuyer },
    },
    accounts: {
      [DEMO_EMAILS.active]: account(DEMO_EMAILS.active),
      [DEMO_EMAILS.pending]: account(DEMO_EMAILS.pending),
      [DEMO_EMAILS.suspended]: account(DEMO_EMAILS.suspended),
      [DEMO_EMAILS.noAccess]: account(DEMO_EMAILS.noAccess),
    },
    fails: {},
    resetTokens: {},
    entitlements: { ...DEMO_ENTITLEMENTS },
    session: null,
    signedOutReason: "none",
    devices: {},
    pendingLogins: {},
    clockOverride: null,
  };
  if (name === "logged_out") return base;
  if (name === "device_limit") {
    // Signed out, but the demo account already has 3 active devices: the next login hits the limit.
    const uid = userIdFor(DEMO_EMAILS.active);
    base.devices[uid] = [
      { id: "dev_old_1", label: "Contoh: iPhone Safari", lastSeenAt: now - 2 * DAY, revokedAt: null },
      { id: "dev_old_2", label: "Contoh: Laptop Firefox", lastSeenAt: now - 5 * DAY, revokedAt: null },
      { id: "dev_old_3", label: "Contoh: Android Chrome", lastSeenAt: now - 12 * DAY, revokedAt: null },
    ];
    return base;
  }

  const email =
    name === "purchase_pending"
      ? DEMO_EMAILS.pending
      : name === "no_active_access"
        ? DEMO_EMAILS.noAccess
        : DEMO_EMAILS.active;
  const userId = userIdFor(email);
  const issuedAt = name === "session_expired" ? now - (PROVISIONAL_AUTH.sessionDays + 1) * DAY : now - DAY;
  base.session = {
    userId,
    email,
    deviceId: "dev_current",
    issuedAt,
    expiresAt: issuedAt + PROVISIONAL_AUTH.sessionDays * DAY,
  };
  base.devices[userId] = [
    { id: "dev_current", label: "Perangkat ini (Chrome)", lastSeenAt: issuedAt, revokedAt: null },
    { id: "dev_other_1", label: "Contoh: iPhone Safari", lastSeenAt: now - 3 * DAY, revokedAt: null },
    { id: "dev_other_2", label: "Contoh: Laptop Firefox", lastSeenAt: now - 9 * DAY, revokedAt: null },
  ];
  return base;
}

/** Stable fake user id from an email. Not a hash for security, only for the mock. */
export function userIdFor(email: string): string {
  let h = 5381;
  for (const ch of email) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `u_${h.toString(16).padStart(8, "0")}`;
}
