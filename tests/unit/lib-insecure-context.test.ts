import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256HexSync } from "@/lib/sha256";
import { uuidV4 } from "@/lib/uuid";

describe("LAN-01 app works without a secure context (http://192.168.x.x)", () => {
  it("pure SHA-256 fallback matches node:crypto", () => {
    for (const s of ["", "abc", "tt-demo-only:demo-password-aman", "x".repeat(1000)]) {
      const data = new TextEncoder().encode(s);
      expect(sha256HexSync(data)).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });
  it("uuidV4 falls back to getRandomValues when randomUUID is unavailable", () => {
    const orig = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const id = uuidV4();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(uuidV4()).not.toBe(id);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: orig, configurable: true });
    }
  });
});
