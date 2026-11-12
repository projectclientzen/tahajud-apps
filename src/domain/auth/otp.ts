/**
 * Email OTP rules (PRD §24.1). Times are epoch milliseconds passed in by the caller.
 * These numbers are fixed by the PRD, not provisional.
 */
export const OTP_RULES = {
  length: 6,
  ttlMs: 10 * 60_000,
  maxAttemptsPerCode: 5,
  maxRequestsPerHour: 5,
  windowMs: 60 * 60_000,
  resendCooldownMs: 60_000,
} as const;

export const isValidOtpFormat = (code: string): boolean => /^\d{6}$/.test(code);

/** `randomInt(max)` returns an integer in [0, max). Injected so tests need no RNG. */
export function generateOtp(randomInt: (max: number) => number): string {
  return String(randomInt(10 ** OTP_RULES.length)).padStart(OTP_RULES.length, "0");
}

export type RequestDecision =
  { ok: true } | { ok: false; reason: "cooldown" | "hourly_limit"; retryAfterSeconds: number };

/** `sentAt` = every send time for this email. Allowed when cooled down and under 5 in the last hour. */
export function decideOtpRequest(sentAt: readonly number[], now: number): RequestDecision {
  const recent = sentAt.filter((t) => now - t < OTP_RULES.windowMs).sort((a, b) => a - b);
  const last = recent.at(-1);
  if (recent.length >= OTP_RULES.maxRequestsPerHour) {
    const frees = recent[recent.length - OTP_RULES.maxRequestsPerHour]! + OTP_RULES.windowMs;
    return { ok: false, reason: "hourly_limit", retryAfterSeconds: Math.ceil((frees - now) / 1000) };
  }
  if (last !== undefined && now - last < OTP_RULES.resendCooldownMs) {
    return {
      ok: false,
      reason: "cooldown",
      retryAfterSeconds: Math.ceil((last + OTP_RULES.resendCooldownMs - now) / 1000),
    };
  }
  return { ok: true };
}

export interface OtpRecord {
  code: string;
  issuedAt: number;
  attempts: number;
  consumed: boolean;
}

export const newOtpRecord = (code: string, now: number): OtpRecord => ({
  code,
  issuedAt: now,
  attempts: 0,
  consumed: false,
});

export type VerifyFailure = "none" | "expired" | "too_many" | "invalid";
export type VerifyResult =
  { ok: true; record: OtpRecord } | { ok: false; reason: VerifyFailure; record: OtpRecord | null };

/**
 * Check a typed code. A wrong code costs one attempt. After 5 wrong attempts the code is dead, even if
 * the right one arrives later. A correct code works once. The caller should show one generic message
 * for every failure so nothing leaks about the email.
 */
export function checkOtp(record: OtpRecord | null, code: string, now: number): VerifyResult {
  if (!record) return { ok: false, reason: "none", record: null };
  if (record.consumed) return { ok: false, reason: "invalid", record };
  if (now - record.issuedAt > OTP_RULES.ttlMs) return { ok: false, reason: "expired", record };
  if (record.attempts >= OTP_RULES.maxAttemptsPerCode) return { ok: false, reason: "too_many", record };
  if (code !== record.code) {
    return { ok: false, reason: "invalid", record: { ...record, attempts: record.attempts + 1 } };
  }
  return { ok: true, record: { ...record, consumed: true } };
}
