import { PROVISIONAL_AUTH } from "../config/provisional";

export interface DeviceRef {
  id: string;
  lastSeenAt: number;
}

/**
 * Device limit (PRD §24.1, owner decision v1.2.3). The 4th login is refused after the OTP is correct.
 * Nothing is signed out automatically: the user picks one device to remove, or cancels.
 */
export type DeviceLimitDecision = { ok: true } | { ok: false; max: number };

export function checkDeviceLimit(
  active: readonly DeviceRef[],
  max: number = PROVISIONAL_AUTH.maxActiveDevices,
): DeviceLimitDecision {
  return active.length < max ? { ok: true } : { ok: false, max };
}

/** A pending login lives 10 minutes and works once (PRD §24.1). */
export const PENDING_LOGIN_TTL_MS = 10 * 60_000;

export interface PendingLogin {
  email: string;
  userId: string;
  createdAt: number;
  used: boolean;
}

export type PendingLoginCheck = { ok: true } | { ok: false; reason: "missing" | "expired" | "used" };

export function checkPendingLogin(p: PendingLogin | null | undefined, now: number): PendingLoginCheck {
  if (!p) return { ok: false, reason: "missing" };
  if (p.used) return { ok: false, reason: "used" };
  if (now - p.createdAt > PENDING_LOGIN_TTL_MS) return { ok: false, reason: "expired" };
  return { ok: true };
}
