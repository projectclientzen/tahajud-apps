// DEMO DATA: bukan data asli
import { PROVISIONAL_AUTH } from "@/domain/config/provisional";
import type { AuthState, EntitlementStatus } from "../auth";

/** Reserved `.test` domain: these addresses can never belong to a real person. */
export const DEMO_EMAILS = {
  active: "demo@ngajigaes.test",
  pending: "pending@ngajigaes.test",
  suspended: "suspended@ngajigaes.test",
  /** Any other address verifies fine but has no entitlement. */
  noAccess: "noaccess@ngajigaes.test",
} as const;

export const DEMO_ENTITLEMENTS: Record<string, EntitlementStatus> = {
  [DEMO_EMAILS.active]: "active",
  [DEMO_EMAILS.pending]: "pending_verification",
  [DEMO_EMAILS.suspended]: "suspended",
};

export const AUTH_SCENARIOS = [
  "logged_out",
  "logged_in",
  "purchase_pending",
  "no_active_access",
  "session_expired",
] as const;
export type AuthScenarioName = (typeof AUTH_SCENARIOS)[number];

const DAY = 86_400_000;

export function buildAuthScenario(name: AuthScenarioName, now: number): AuthState {
  const base: AuthState = {
    schemaVersion: 1,
    scenario: name,
    otps: {},
    sentAt: {},
    outbox: [],
    entitlements: { ...DEMO_ENTITLEMENTS },
    session: null,
    signedOutReason: "none",
    devices: {},
    clockOverride: null,
  };
  if (name === "logged_out") return base;

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
