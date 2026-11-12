import { PROVISIONAL_AUTH } from "../config/provisional";

export type PasswordProblem = "too_short" | "too_long" | "common" | "same_as_email" | "same_as_phone";

export interface PasswordContext {
  email?: string;
  /** Normalized or raw phone. Compared by digits only. */
  phone?: string;
}

/** NFKC so that visually identical passwords hash the same on every keyboard. */
export const normalizePassword = (raw: string): string => raw.normalize("NFKC");

/**
 * A small bundled list. No call to an outside service, so nothing about a password ever leaves the server.
 * It is a floor, not a guarantee: the length rule does most of the work.
 */
const COMMON = new Set(
  [
    "password", "password1", "password12", "password123", "password1234", "passw0rd123", "qwerty123456", "qwertyuiop",
    "1234567890", "12345678910", "0123456789", "0987654321", "1q2w3e4r5t", "1qaz2wsx3e", "abcdefghij", "abcd123456",
    "iloveyou123", "letmein1234", "welcome1234", "admin12345", "administrator", "bismillah", "bismillah1", "bismillah12",
    "bismillah123", "bismillah1234", "alhamdulillah", "assalamualaikum", "subhanallah", "allahuakbar", "astaghfirullah",
    "masyaallah", "ngajigaes", "ngajigaes1", "ngajigaes12", "ngajigaes123", "ngajigaes1234", "tahajud123", "tahajud1234",
    "tahajudtracker", "sholat123", "sholat1234", "tahajudku", "indonesia1", "indonesia12", "indonesia123", "indonesia1234",
    "sayangkamu", "sayangkamu1", "cintakamu", "123456789a", "a123456789", "kucingku123", "rahasia123", "rahasia1234",
    "jakarta123", "jakarta1234", "bandung123", "surabaya123", "makassar123", "qazwsxedc123", "zaq12wsxcde",
    "pass123456", "pass1234567", "test123456", "test1234567", "demo123456", "demo-password",
  ].map((s) => s.toLowerCase()),
);

/** All-same or simple ascending runs such as `aaaaaaaaaa` or `1234567890`. */
function isTrivial(p: string): boolean {
  if (/^(.)\1+$/u.test(p)) return true;
  const codes = [...p].map((c) => c.codePointAt(0)!);
  return codes.length >= 8 && codes.every((c, i) => i === 0 || c - codes[i - 1]! === 1);
}

/** Returns the first problem, or null when the password is acceptable. Length counts characters after NFKC. */
export function checkPassword(raw: string, ctx: PasswordContext = {}): PasswordProblem | null {
  const p = normalizePassword(raw);
  const len = [...p].length;
  if (len < PROVISIONAL_AUTH.passwordMinLength) return "too_short";
  if (len > PROVISIONAL_AUTH.passwordMaxLength) return "too_long";
  const lower = p.toLowerCase();
  if (ctx.email) {
    const email = ctx.email.trim().toLowerCase();
    const local = email.split("@")[0] ?? "";
    if (lower === email || (local.length >= 6 && lower === local)) return "same_as_email";
  }
  if (ctx.phone) {
    const digits = ctx.phone.replace(/\D/g, "");
    const pd = lower.replace(/\D/g, "");
    if (digits.length >= 8 && pd.length >= 8 && (pd === digits || pd === `0${digits.replace(/^62/, "")}`)) {
      return "same_as_phone";
    }
  }
  if (COMMON.has(lower) || isTrivial(lower)) return "common";
  return null;
}

export const PASSWORD_PROBLEM_MESSAGE: Record<PasswordProblem, string> = {
  too_short: `Password minimal ${PROVISIONAL_AUTH.passwordMinLength} karakter.`,
  too_long: `Password maksimal ${PROVISIONAL_AUTH.passwordMaxLength} karakter.`,
  common: "Password ini terlalu umum. Pakai kalimat atau gabungan kata yang lebih sulit ditebak.",
  same_as_email: "Password tidak boleh sama dengan email.",
  same_as_phone: "Password tidak boleh sama dengan nomor HP.",
};
