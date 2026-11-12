import { UUID_RE } from "@/server/db/types";

export const SESSION_COOKIE = "tt_session";

/** `<deviceId>.<secret>`. The secret is random, only its hash is stored. */
export function parseSessionCookie(header: string | null): { deviceId: string; secret: string } | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(i + 1).trim();
    const dot = value.indexOf(".");
    if (dot <= 0) return null;
    const deviceId = value.slice(0, dot);
    const secret = value.slice(dot + 1);
    if (!UUID_RE.test(deviceId) || secret.length < 20 || secret.length > 128 || !/^[A-Za-z0-9_-]+$/.test(secret))
      return null;
    return { deviceId, secret };
  }
  return null;
}

/** HttpOnly, SameSite=Lax, Secure on https (PRD §24.1). */
export function sessionCookie(deviceId: string, secret: string, expiresAt: Date, now: Date, secure: boolean): string {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  return [
    `${SESSION_COOKIE}=${deviceId}.${secret}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax", secure ? "Secure" : ""]
    .filter(Boolean)
    .join("; ");
}

export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return proto ? proto === "https" : new URL(req.url).protocol === "https:";
}
