import { describe, expect, it } from "vitest";
import { PENDING_LOGIN_TTL_MS, checkDeviceLimit, checkPendingLogin } from "@/domain/auth/devices";
import { isPlausibleEmail, normalizeEmail } from "@/domain/auth/email";
import { checkPassword, normalizePassword } from "@/domain/auth/password-policy";
import { normalizePhone, phoneTail } from "@/domain/auth/phone";
import { addAttempt, isThrottled, recentCount } from "@/domain/auth/throttle";
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

describe("phone normalization (activation proof)", () => {
  it.each([
    ["081234567890", "6281234567890"],
    ["0812-3456-7890", "6281234567890"],
    ["+62 812 3456 7890", "6281234567890"],
    ["+62-812-3456-7890", "6281234567890"],
    ["(0812) 3456.7890", "6281234567890"],
    ["6281234567890", "6281234567890"],
    ["81234567890", "6281234567890"],
    ["  0812 3456 7890  ", "6281234567890"],
    ["+14155550123", "14155550123"],
    ["0014155550123", "14155550123"],
  ])("%s becomes %s", (raw, out) => {
    expect(normalizePhone(raw)).toBe(out);
  });

  it.each(["", "   ", "abc", "0812-ABC-7890", "081234", "+0812345678", "00", "0".repeat(20), "+62 812 3456 7890 12345678", "08123456789012345"])(
    "%j is not a phone number",
    (raw) => {
      expect(normalizePhone(raw)).toBeNull();
    },
  );

  it("equal numbers written differently match (the point of the function)", () => {
    const forms = ["0812-3456-7890", "+6281234567890", "62 812 3456 7890", "812 3456 7890"];
    expect(new Set(forms.map(normalizePhone)).size).toBe(1);
  });

  it("shows at most the last 4 digits", () => {
    expect(phoneTail("6281234567890")).toBe("7890");
    expect(phoneTail("12")).toBe("");
  });
});

describe("password policy (provisional numbers)", () => {
  it("snapshot of the provisional numbers", () => {
    expect(PROVISIONAL_AUTH.passwordMinLength).toBe(10);
    expect(PROVISIONAL_AUTH.passwordMaxLength).toBe(128);
    expect(PROVISIONAL_AUTH.adminResetTokenMinutes).toBe(60);
    expect(PROVISIONAL_AUTH.limits).toMatchObject({
      loginFailsPerEmail: 10,
      loginFailWindowSeconds: 900,
      activateFailsPerEmail: 5,
      activateFailsPerPhone: 5,
      activateIpPerHour: 20,
      activatePairPerHour: 3,
    });
    expect(PROVISIONAL_AUTH.provisional).toBe(true);
  });

  it("accepts a long passphrase without composition rules", () => {
    expect(checkPassword("kopi susu gula aren pagi")).toBeNull();
    expect(checkPassword("abcdefghij1")).toBeNull();
    expect(checkPassword("a".repeat(9))).toBe("too_short");
    expect(checkPassword("a-b_c.d!e@")).toBeNull();
  });
  it("counts characters, not bytes, and normalizes with NFKC", () => {
    expect(checkPassword("ｋｏｐｉｓｕｓｕ１２３")).toBeNull(); // full width letters fold to ASCII
    expect(normalizePassword("ｐａｓｓ")).toBe("pass");
    expect(checkPassword("éèêëàâäôöü")).toBeNull();
    expect(checkPassword("😀🙂😎🤔😴🥳🤩😇🧐😋")).toBeNull(); // 10 characters, 40 bytes
    expect(checkPassword("😀🙂😎🤔😴🥳🤩😇🧐")).toBe("too_short"); // 9 characters
    expect(checkPassword("kopi".repeat(32))).toBeNull();
    expect(checkPassword("kopi".repeat(32) + "x")).toBe("too_long");
  });
  it("rejects common and trivial passwords, ignoring case", () => {
    for (const p of ["password123", "PASSWORD123", "1234567890", "bismillah123", "qwertyuiop", "aaaaaaaaaa", "abcdefghij"]) {
      expect(checkPassword(p), p).toBe("common");
    }
  });
  it("rejects the email, its local part, and the phone", () => {
    expect(checkPassword("zen.ngaji@gmail.com", { email: "Zen.Ngaji@Gmail.com" })).toBe("same_as_email");
    expect(checkPassword("zen.ngaji", { email: "zen.ngaji@gmail.com" })).toBe("too_short");
    expect(checkPassword("zenngajigaes", { email: "zenngajigaes@gmail.com" })).toBe("same_as_email");
    expect(checkPassword("081234567890", { phone: "0812-3456-7890" })).toBe("same_as_phone");
    expect(checkPassword("6281234567890", { phone: "081234567890" })).toBe("same_as_phone");
    expect(checkPassword("kata sandi yang lain", { email: "a@b.id", phone: "081234567890" })).toBeNull();
  });
});

describe("demo sign-in throttle", () => {
  const W = 15 * MIN;
  it("counts attempts in the window and forgets older ones", () => {
    const t = [0, MIN, 2 * MIN];
    expect(recentCount(t, 3 * MIN, W)).toBe(3);
    expect(recentCount(t, 16 * MIN, W)).toBe(1);
    expect(isThrottled(t, 3 * MIN, W, 3)).toBe(true);
    expect(isThrottled(t, 16 * MIN, W, 3)).toBe(false);
  });
  it("addAttempt drops old entries so saved state stays small", () => {
    expect(addAttempt([0, MIN], 20 * MIN, W)).toEqual([20 * MIN]);
  });
});

describe("devices (limit is provisional)", () => {
  it("keeps the PROV limit at 3", () =>
    expect(PROVISIONAL_AUTH).toMatchObject({ provisional: true, maxActiveDevices: 3, sessionDays: 30 }));
  it("AUTH-DEVICE: refuses a 4th device and never picks one to sign out by itself", () => {
    const d = [
      { id: "a", lastSeenAt: 30 },
      { id: "b", lastSeenAt: 10 },
      { id: "c", lastSeenAt: 20 },
    ];
    expect(checkDeviceLimit(d)).toEqual({ ok: false, max: 3 });
    expect(checkDeviceLimit(d.slice(0, 2))).toEqual({ ok: true });
    expect(checkDeviceLimit([])).toEqual({ ok: true });
    expect(checkDeviceLimit(d, 4)).toEqual({ ok: true });
  });
  it("a pending login works for 10 minutes and once", () => {
    const p = { email: "a@b.test", userId: "u", createdAt: 1_000, used: false };
    expect(checkPendingLogin(p, 1_000 + PENDING_LOGIN_TTL_MS)).toEqual({ ok: true });
    expect(checkPendingLogin(p, 1_000 + PENDING_LOGIN_TTL_MS + 1)).toEqual({ ok: false, reason: "expired" });
    expect(checkPendingLogin({ ...p, used: true }, 2_000)).toEqual({ ok: false, reason: "used" });
    expect(checkPendingLogin(undefined, 2_000)).toEqual({ ok: false, reason: "missing" });
  });
});
