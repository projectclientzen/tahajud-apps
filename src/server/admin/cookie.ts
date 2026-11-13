import { UUID_RE } from "@/server/db/types";

export const ADMIN_COOKIE = "tt_admin";

/** `<adminSessionId>.<secret>`. Only a hash of the secret is stored. */
export function parseAdminCookie(header: string | null): { sessionId: string; secret: string } | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== ADMIN_COOKIE) continue;
    const value = part.slice(i + 1).trim();
    const dot = value.indexOf(".");
    if (dot <= 0) return null;
    const sessionId = value.slice(0, dot);
    const secret = value.slice(dot + 1);
    if (!UUID_RE.test(sessionId) || secret.length < 20 || secret.length > 128 || !/^[A-Za-z0-9_-]+$/.test(secret)) return null;
    return { sessionId, secret };
  }
  return null;
}

/** HttpOnly, SameSite=Strict, Secure on https. Max-Age is the absolute 8 hour limit: it is never extended. */
export function adminCookie(sessionId: string, secret: string, expiresAt: Date, now: Date, secure: boolean): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return [`${ADMIN_COOKIE}=${sessionId}.${secret}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Strict", secure ? "Secure" : ""]
    .filter(Boolean)
    .join("; ");
}

export const clearAdminCookie = (secure: boolean): string =>
  [`${ADMIN_COOKIE}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Strict", secure ? "Secure" : ""].filter(Boolean).join("; ");
