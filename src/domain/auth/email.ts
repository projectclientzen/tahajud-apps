/** Trim, lowercase, Unicode NFC. Dots and `+tag` are kept (PRD §17.1). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase().normalize("NFC");
}

/** Loose shape check for the login form. Real validation is the OTP arriving. */
export function isPlausibleEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(raw));
}
