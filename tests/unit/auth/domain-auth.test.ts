import { describe, expect, it } from "vitest";
import { devicesToRevoke } from "@/domain/auth/devices";
import { isPlausibleEmail, normalizeEmail } from "@/domain/auth/email";
import { OTP_RULES, checkOtp, decideOtpRequest, generateOtp, isValidOtpFormat, newOtpRecord } from "@/domain/auth/otp";
import { PROVISIONAL_AUTH } from "@/domain/config/provisional";

const MIN = 60_000;

describe("email", () => {
  it("normalizes: trim, lowercase, NFC; keeps dots and +tag", () => {
    expect(normalizeEmail("  Zen.Test+Tag@Example.COM ")).toBe("zen.test+tag@example.com");
    expect(normalizeEmail("é@x.id")).toBe("é@x.id"); // e + combining acute -> é
  });
  it("checks loose shape", () => {
    expect(isPlausibleEmail("a@b.id")).toBe(true);
    expect(isPlausibleEmail("a@b")).toBe(false);
    expect(isPlausibleEmail("a b@c.id")).toBe(false);
    expect(isPlausibleEmail("")).toBe(false);
  });
});

describe("OTP rules (PRD §24.1, fixed numbers)", () => {
  it("snapshot of the fixed rules", () => {
    expect(OTP_RULES).toEqual({
      length: 6,
      ttlMs: 600_000,
      maxAttemptsPerCode: 5,
      maxRequestsPerHour: 5,
      windowMs: 3_600_000,
      resendCooldownMs: 60_000,
    });
  });
  it("generates a zero padded 6 digit code", () => {
    expect(generateOtp(() => 42)).toBe("000042");
    expect(generateOtp(() => 999_999)).toBe("999999");
    expect(isValidOtpFormat("000042")).toBe(true);
    expect(isValidOtpFormat("12345")).toBe(false);
    expect(isValidOtpFormat("12345a")).toBe(false);
  });

  it("allows the first request, then makes the user wait 60 seconds", () => {
    expect(decideOtpRequest([], 1000)).toEqual({ ok: true });
    expect(decideOtpRequest([0], 59_000)).toEqual({ ok: false, reason: "cooldown", retryAfterSeconds: 1 });
    expect(decideOtpRequest([0], 60_000)).toEqual({ ok: true });
  });
  it("AUTH-06 allows 5 requests per hour and refuses the 6th", () => {
    const sent = [0, 1, 2, 3, 4].map((i) => i * 61_000);
    const at = 5 * 61_000;
    const d = decideOtpRequest(sent, at);
    expect(d).toMatchObject({ ok: false, reason: "hourly_limit" });
    // frees when the first send leaves the 1 hour window
    expect(d.ok === false && d.retryAfterSeconds).toBe(Math.ceil((OTP_RULES.windowMs - at) / 1000));
    expect(decideOtpRequest(sent, OTP_RULES.windowMs + 1)).toEqual({ ok: true });
  });
  it("ignores sends older than one hour", () => {
    expect(
      decideOtpRequest(
        [0, 1, 2, 3, 4].map((i) => i * 1000),
        2 * OTP_RULES.windowMs,
      ),
    ).toEqual({ ok: true });
  });

  it("accepts the right code once, within 10 minutes", () => {
    const rec = newOtpRecord("123456", 0);
    const ok = checkOtp(rec, "123456", 9 * MIN);
    expect(ok.ok).toBe(true);
    const again = checkOtp(ok.ok ? ok.record : null, "123456", 9 * MIN);
    expect(again).toMatchObject({ ok: false, reason: "invalid" });
  });
  it("expires after 10 minutes", () => {
    expect(checkOtp(newOtpRecord("123456", 0), "123456", 10 * MIN + 1)).toMatchObject({ ok: false, reason: "expired" });
    expect(checkOtp(newOtpRecord("123456", 0), "123456", 10 * MIN).ok).toBe(true);
  });
  it("counts wrong attempts and locks the code after 5, even for the right code", () => {
    let rec = newOtpRecord("123456", 0);
    for (let i = 1; i <= 5; i++) {
      const r = checkOtp(rec, "000000", MIN);
      expect(r).toMatchObject({ ok: false, reason: "invalid" });
      rec = r.record!;
      expect(rec.attempts).toBe(i);
    }
    expect(checkOtp(rec, "123456", MIN)).toMatchObject({ ok: false, reason: "too_many" });
  });
  it("reports 'none' when no code was requested", () => {
    expect(checkOtp(null, "123456", 0)).toEqual({ ok: false, reason: "none", record: null });
  });
});

describe("devices (limit is provisional)", () => {
  it("keeps the PROV limit at 3", () =>
    expect(PROVISIONAL_AUTH).toMatchObject({ provisional: true, maxActiveDevices: 3, sessionDays: 30 }));
  it("revokes the least recently seen device when a new login would pass the limit", () => {
    const d = [
      { id: "a", lastSeenAt: 30 },
      { id: "b", lastSeenAt: 10 },
      { id: "c", lastSeenAt: 20 },
    ];
    expect(devicesToRevoke(d)).toEqual(["b"]);
    expect(devicesToRevoke(d.slice(0, 2))).toEqual([]);
    expect(devicesToRevoke(d, 1)).toEqual(["b", "c", "a"].slice(0, 3));
  });
});
