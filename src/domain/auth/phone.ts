/**
 * Indonesian mobile number normalization for account activation (CLAUDE.md, auth rules).
 * `08123`, `+628123`, `628123` and `8123` all become `628123`. Spaces, dashes, dots and brackets are dropped.
 * Numbers that start with another country code (`+44...`, `0044...`) keep their digits.
 * Returns null when the input cannot be a phone number. Never throws, never logs.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > 32) return null;
  // Only digits and these separators are allowed. Letters mean it is not a phone number.
  if (!/^\+?[\d\s\-.()]+$/.test(trimmed)) return null;
  const plus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (digits === "") return null;

  if (plus) {
    // "+62..." or another country code. "+0..." is not valid.
    if (digits.startsWith("0")) return null;
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
    if (digits === "" || digits.startsWith("0")) return null;
  } else if (digits.startsWith("0")) {
    digits = `62${digits.slice(1)}`;
  } else if (digits.startsWith("8")) {
    // "8123456789": the leading zero was dropped by a spreadsheet or a form.
    digits = `62${digits}`;
  }
  // E.164 allows up to 15 digits. Indonesian mobile numbers are 62 + 9 to 12 digits.
  if (digits.length < 8 || digits.length > 15) return null;
  if (digits.startsWith("62") && (digits.length < 11 || digits.length > 14)) return null;
  return digits;
}

/** Last 4 digits for places that may show a partial number (admin lists). Empty when too short. */
export function phoneTail(normalized: string): string {
  return normalized.length >= 4 ? normalized.slice(-4) : "";
}
