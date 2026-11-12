import { ZodError, type ZodType } from "zod";
import { ApiError } from "@/data/contracts";
import { HTTP_STATUS, mapDbError, DbConfigError } from "@/server/db";

/** Every answer from /api/v1 carries these (PRD §19, SEC-05). Nothing private is ever cached by a browser or a proxy. */
const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie, Origin",
};

export function jsonResponse(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

export function errorResponse(e: ApiError, cookies: string[] = []): Response {
  const extra =
    e.code === "RATE_LIMITED" &&
    typeof (e.details as { retry_after_seconds?: unknown } | undefined)?.retry_after_seconds === "number"
      ? { "Retry-After": String((e.details as { retry_after_seconds: number }).retry_after_seconds) }
      : {};
  const res = jsonResponse(e.toJSON(), HTTP_STATUS[e.code] ?? 500, cookies);
  for (const [k, v] of Object.entries(extra)) res.headers.set(k, v);
  return res;
}

/** Turns anything thrown into the one error shape. Unknown failures say nothing about their cause. */
export function toApiError(e: unknown, path: string): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof DbConfigError) {
    // The cause is for whoever runs the server. It is logged, not sent to the browser.
    console.error("api_config_error", { path, message: e.message });
    return new ApiError("NOT_AVAILABLE", "Server belum dikonfigurasi. Hubungi admin.");
  }
  if (e instanceof ZodError) {
    return new ApiError("VALIDATION_ERROR", "Data yang dikirim belum sesuai.", {
      issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  const mapped = mapDbError(e);
  if (mapped) return mapped;
  // Only the SQLSTATE is logged: error messages from the database can contain row values.
  console.error("api_error", { path, name: (e as Error)?.name, sqlstate: (e as { code?: string })?.code });
  // Set API_DEBUG_ERRORS=1 on a developer machine to see the whole error. Never in production: it may hold row values.
  if (process.env.API_DEBUG_ERRORS === "1") console.error(e);
  return new ApiError("NOT_AVAILABLE", "Terjadi gangguan di server. Coba lagi sebentar.");
}

const MAX_BODY_BYTES = 64 * 1024;

/** Reads a JSON body of at most 64 KB and checks it against the shared schema. */
export async function readBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new ApiError("VALIDATION_ERROR", "Data terlalu besar.");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError("VALIDATION_ERROR", "Data terlalu besar.");
  let raw: unknown;
  try {
    raw = text === "" ? {} : JSON.parse(text);
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Data yang dikirim bukan JSON yang benar.");
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw r.error;
  return r.data;
}

/**
 * Origin check for mutating requests (PRD §24.1, SEC-11). A browser always sends Origin on POST, PUT, PATCH and DELETE.
 * A missing or foreign Origin is refused. Allowed: the host the request was sent to, plus APP_ORIGINS.
 */
export function originAllowed(req: Request, allowed: readonly string[]): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false; // includes the literal "null"
  }
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || new URL(req.url).host;
  return o.host === host || allowed.includes(o.origin);
}
