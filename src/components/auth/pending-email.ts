/**
 * The email being signed in, kept for this tab only so the verify screen survives a reload.
 * Never in the URL (history, referrers) and never in localStorage (stays after the tab closes).
 */
const KEY = "tt-login";

export interface PendingEmail {
  email: string;
  /** Epoch ms. The resend button wakes up at this time. */
  resendAt: number;
}

export function readPendingEmail(): PendingEmail | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PendingEmail>;
    return typeof v.email === "string" && typeof v.resendAt === "number"
      ? { email: v.email, resendAt: v.resendAt }
      : null;
  } catch {
    return null;
  }
}

export function writePendingEmail(v: PendingEmail): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage blocked: the verify screen sends the user back to login */
  }
}

export function clearPendingEmail(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
