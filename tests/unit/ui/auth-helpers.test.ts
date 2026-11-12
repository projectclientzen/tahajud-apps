import { describe, expect, it } from "vitest";
import { cooldownSeconds, otpRequestMessage } from "@/components/auth/otp-errors";
import { ApiError } from "@/data/contracts";
import { describeDevice } from "@/lib/device-label";
import { whatsappLink } from "@/lib/env";

const limited = (reason: "cooldown" | "hourly_limit", retry_after_seconds: number) =>
  new ApiError("RATE_LIMITED", "x", { reason, retry_after_seconds });

describe("AUTH-06 friendly OTP messages", () => {
  it("never shows an error code and says how long to wait", () => {
    expect(otpRequestMessage(limited("hourly_limit", 1500))).toBe(
      "Terlalu sering meminta kode. Coba lagi dalam 25 menit.",
    );
    expect(otpRequestMessage(limited("hourly_limit", 45))).toBe(
      "Terlalu sering meminta kode. Coba lagi dalam 45 detik.",
    );
    expect(otpRequestMessage(new ApiError("RATE_LIMITED", "x"))).toBe(
      "Terlalu sering meminta kode. Coba lagi sebentar lagi.",
    );
    for (const e of [limited("cooldown", 30), new ApiError("VALIDATION_ERROR", "x"), new Error("boom")]) {
      expect(otpRequestMessage(e)).not.toMatch(/RATE_LIMITED|VALIDATION_ERROR|boom/);
    }
  });
  it("explains a bad email and an offline device", () => {
    expect(otpRequestMessage(new ApiError("VALIDATION_ERROR", "x"))).toContain("Format email belum benar");
    expect(otpRequestMessage(new ApiError("OFFLINE", "x"))).toContain("offline");
  });
  it("only the 60 second cooldown counts as 'code already sent'", () => {
    expect(cooldownSeconds(limited("cooldown", 42))).toBe(42);
    expect(cooldownSeconds(limited("hourly_limit", 900))).toBe(0);
    expect(cooldownSeconds(new Error("x"))).toBe(0);
  });
});

describe("device label", () => {
  it.each([
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
      "Chrome di Android",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
      "Safari di iPhone",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0",
      "Edge di Windows",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", "Firefox di Linux"],
    ["", "Perangkat baru"],
  ])("%s", (ua, label) => expect(describeDevice(ua)).toBe(label));
});

describe("customer service WhatsApp link", () => {
  it("is hidden when no number is set", () => expect(whatsappLink("Halo", "")).toBeNull());
  it("builds a wa.me link with an encoded message and no personal data", () => {
    const href = whatsappLink("Halo CS, kode tidak datang.", "6281234567890");
    expect(href).toBe("https://wa.me/6281234567890?text=Halo%20CS%2C%20kode%20tidak%20datang.");
  });
});
