import { describe, expect, it } from "vitest";
import { DEFAULT_SCRYPT, dummyHash, hashPassword, needsRehash, verifyPassword } from "@/server/auth/password";
import { hashPhone, hmacHex } from "@/server/auth/crypto";

const CHEAP = { ln: 10, r: 8, p: 1 };

describe("password hashing (scrypt from node:crypto)", () => {
  it("starts from N=2^15, r=8, p=3 (OWASP equivalent setting, checked 13 Nov 2026)", () => {
    expect(DEFAULT_SCRYPT).toEqual({ ln: 15, r: 8, p: 3 });
  });

  it("the default settings really run (maxmem is raised above Node's 32 MiB default)", async () => {
    const h = await hashPassword("kata sandi panjang sekali", DEFAULT_SCRYPT);
    expect(h).toMatch(/^\$scrypt\$ln=15,r=8,p=3\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(await verifyPassword("kata sandi panjang sekali", h)).toBe(true);
    expect(await verifyPassword("kata sandi panjang sekalI", h)).toBe(false);
  }, 20_000);

  it("uses a new salt every time and never contains the password", async () => {
    const a = await hashPassword("rahasia-banget-123", CHEAP);
    const b = await hashPassword("rahasia-banget-123", CHEAP);
    expect(a).not.toBe(b);
    expect(a).not.toContain("rahasia");
    expect(await verifyPassword("rahasia-banget-123", a)).toBe(true);
    expect(await verifyPassword("rahasia-banget-123", b)).toBe(true);
  });

  it("verifies with the settings stored in the hash, whatever the current ones are", async () => {
    const old = await hashPassword("sandi-lama-saya-1", { ln: 11, r: 8, p: 1 });
    expect(old).toContain("ln=11,r=8,p=1");
    expect(await verifyPassword("sandi-lama-saya-1", old)).toBe(true);
  });

  it("treats visually identical Unicode as the same password (NFKC)", async () => {
    const h = await hashPassword("ｋｏｐｉ-susu-123", CHEAP);
    expect(await verifyPassword("kopi-susu-123", h)).toBe(true);
  });

  it("a malformed or hostile stored value is simply a mismatch, never an error or a memory bomb", async () => {
    for (const bad of [
      "",
      "plain",
      "$scrypt$",
      "$scrypt$ln=99,r=8,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA",
      "$scrypt$ln=10,r=999,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA",
      "$scrypt$ln=10,r=8,p=99$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA",
      "$scrypt$ln=3,r=8,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA",
      "$scrypt$ln=10,r=8,p=1$YQ$YQ",
      "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA",
    ]) {
      expect(await verifyPassword("apa saja", bad), bad).toBe(false);
    }
  });

  it("needsRehash is true only when the stored settings are weaker", async () => {
    const h = await hashPassword("sandi-uji-satu", { ln: 10, r: 8, p: 1 });
    expect(needsRehash(h, { ln: 10, r: 8, p: 1 })).toBe(false);
    expect(needsRehash(h, { ln: 11, r: 8, p: 1 })).toBe(true);
    expect(needsRehash(h, { ln: 10, r: 8, p: 2 })).toBe(true);
    expect(needsRehash(h, { ln: 9, r: 8, p: 1 })).toBe(false);
    expect(needsRehash("garbage", CHEAP)).toBe(true);
  });

  it("the dummy hash is valid, cached per settings, and matches no password", async () => {
    const d1 = await dummyHash(CHEAP);
    expect(await dummyHash(CHEAP)).toBe(d1);
    expect(await verifyPassword("password123456", d1)).toBe(false);
    expect(d1).toContain("ln=10,r=8,p=1");
  });
});

describe("keyed hashes", () => {
  const pepper = "p".repeat(32);
  it("a phone hash is the same for every way of writing the number, and differs per pepper", () => {
    const a = hashPhone(pepper, "0812-3456-7890");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPhone(pepper, "+62 812 3456 7890")).toBe(a);
    expect(hashPhone("q".repeat(32), "0812-3456-7890")).not.toBe(a);
    expect(hashPhone(pepper, "bukan nomor")).toBeNull();
  });
  it("scopes keep one purpose from matching another", () => {
    expect(hmacHex(pepper, "phone", "62812")).not.toBe(hmacHex(pepper, "email", "62812"));
  });
});
