import { describe, expect, it } from "vitest";
import { DEFAULT_SCALEV_API_BASE, loadScalevConfig } from "@/server/scalev/config";

const prod = { NODE_ENV: "production" };

describe("Scalev config from the environment", () => {
  it("nothing set: no secret, no key, default API base, everything refuses instead of guessing", () => {
    const c = loadScalevConfig({});
    expect(c).toMatchObject({
      apiBase: DEFAULT_SCALEV_API_BASE,
      apiKey: null,
      storeId: null,
      signingSecret: null,
      signingSecretPrevious: null,
      payloadKey: null,
      minAmountIdr: null,
      sweepEnabled: true,
    });
    expect(c.payloadKeyProblem).toMatch(/SCALEV_PAYLOAD_KEY/);
    expect(c.allowedVariants.ids.size + c.allowedVariants.skus.size).toBe(0);
  });

  it("the payload key must be exactly 32 bytes of base64", () => {
    const good = Buffer.alloc(32, 7).toString("base64");
    expect(loadScalevConfig({ SCALEV_PAYLOAD_KEY: good }).payloadKey?.length).toBe(32);
    expect(loadScalevConfig({ SCALEV_PAYLOAD_KEY: Buffer.alloc(32, 7).toString("base64url") }).payloadKey?.length).toBe(32);
    for (const bad of ["", " ", "short", Buffer.alloc(31).toString("base64"), Buffer.alloc(33).toString("base64"), "not base64 at all!"]) {
      const c = loadScalevConfig({ SCALEV_PAYLOAD_KEY: bad });
      expect(c.payloadKey, bad).toBeNull();
      expect(c.payloadKeyProblem, bad).toBeTruthy();
    }
  });

  it("the API base must be https in production; a local fake is only accepted outside it", () => {
    expect(loadScalevConfig({ ...prod, SCALEV_API_BASE: "https://api.scalev.com/" }).apiBase).toBe("https://api.scalev.com");
    for (const bad of ["http://api.scalev.com", "http://127.0.0.1:9", "ftp://x", "api.scalev.com"]) {
      expect(() => loadScalevConfig({ ...prod, SCALEV_API_BASE: bad }), bad).toThrow(/https/);
    }
    expect(loadScalevConfig({ NODE_ENV: "test", SCALEV_API_BASE: "http://127.0.0.1:4010" }).apiBase).toBe("http://127.0.0.1:4010");
    expect(loadScalevConfig({ NODE_ENV: "development", SCALEV_API_BASE: "http://localhost:4010/" }).apiBase).toBe("http://localhost:4010");
    // a host that only starts with "localhost" is not localhost
    expect(() => loadScalevConfig({ NODE_ENV: "test", SCALEV_API_BASE: "http://localhost.evil.example" })).toThrow(/https/);
    expect(() => loadScalevConfig({ NODE_ENV: "test", SCALEV_API_BASE: "http://127.0.0.1.evil.example" })).toThrow(/https/);
  });

  it("minimum amount: digits only, otherwise no minimum", () => {
    expect(loadScalevConfig({ SCALEV_MIN_AMOUNT_IDR: "50000" }).minAmountIdr).toBe(50000);
    for (const v of ["", "abc", "-5", "5.5", "50.000"]) expect(loadScalevConfig({ SCALEV_MIN_AMOUNT_IDR: v }).minAmountIdr, v).toBeNull();
  });

  it("polling is on unless it is switched off with false or 0", () => {
    expect(loadScalevConfig({}).sweepEnabled).toBe(true);
    expect(loadScalevConfig({ SCALEV_SWEEP_ENABLED: "true" }).sweepEnabled).toBe(true);
    expect(loadScalevConfig({ SCALEV_SWEEP_ENABLED: "false" }).sweepEnabled).toBe(false);
    expect(loadScalevConfig({ SCALEV_SWEEP_ENABLED: "0" }).sweepEnabled).toBe(false);
  });

  it("secrets are trimmed and blank means not set", () => {
    const c = loadScalevConfig({ SCALEV_WEBHOOK_SIGNING_SECRET: "  abc  ", SCALEV_WEBHOOK_SIGNING_SECRET_PREVIOUS: "   ", SCALEV_API_KEY: " ", SCALEV_STORE_ID: " 2785 " });
    expect(c).toMatchObject({ signingSecret: "abc", signingSecretPrevious: null, apiKey: null, storeId: "2785" });
  });
});
