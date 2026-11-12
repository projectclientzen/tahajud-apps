/**
 * Where a signed-in or signed-out visitor must go (PRD §6.1, §6.4). Pure: the screens only read the answer.
 * The server stays the judge of access. This only decides which screen to show for an answer it already gave.
 */
export const GUARD_PATHS = {
  login: "/login",
  accessStatus: "/access-status",
  onboarding: "/onboarding",
  dashboard: "/dashboard",
} as const;

export type GuardNeed =
  /** Inside the app: signed in, active access, onboarding done. */
  | "app"
  /** The onboarding screens: signed in, active access, onboarding not done yet. */
  | "onboarding";

export interface GuardInput {
  authenticated: boolean;
  /** Only read when `authenticated` is false. */
  signedOutReason?: "none" | "expired" | "revoked" | null;
  /** Only read when `authenticated` is true. */
  accessStatus?: "active" | "awaiting_order_verification" | "suspended" | "none";
  onboardingCompleted?: boolean;
}

/** Path to redirect to, or null when the visitor may stay. */
export function guardRedirect(need: GuardNeed, input: GuardInput): string | null {
  if (!input.authenticated) {
    return input.signedOutReason === "expired" || input.signedOutReason === "revoked"
      ? GUARD_PATHS.accessStatus
      : GUARD_PATHS.login;
  }
  if (input.accessStatus !== "active") return GUARD_PATHS.accessStatus;
  const done = input.onboardingCompleted === true;
  if (need === "app") return done ? null : GUARD_PATHS.onboarding;
  return done ? GUARD_PATHS.dashboard : null;
}

export type AccessScreen = "session_expired" | "purchase_pending" | "no_access";

/** Which `/access-status` variant applies. Null means the visitor does not belong there. */
export function accessScreenFor(input: GuardInput): AccessScreen | null {
  if (!input.authenticated) {
    return input.signedOutReason === "expired" || input.signedOutReason === "revoked" ? "session_expired" : null;
  }
  if (input.accessStatus === "awaiting_order_verification") return "purchase_pending";
  if (input.accessStatus === "none" || input.accessStatus === "suspended") return "no_access";
  return null;
}
