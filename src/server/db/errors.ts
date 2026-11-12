import { ApiError, type ApiErrorCode } from "@/data/contracts";

/** Error codes the SQL functions raise as the exception message (T3a-3). */
const SQL_CODES = new Set([
  "ENTITLEMENT_INACTIVE",
  "SESSION_LOCKED",
  "VERSION_CONFLICT",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "LOCATION_REQUIRED",
  "UNAUTHENTICATED",
  "PENDING_LOGIN_INVALID",
]);

const MESSAGES: Record<string, string> = {
  ENTITLEMENT_INACTIVE: "Akses belum aktif untuk akun ini.",
  SESSION_LOCKED: "Sesi ini sudah lewat jendela koreksi.",
  VERSION_CONFLICT: "Data sudah berubah di perangkat lain.",
  NOT_FOUND: "Data tidak ditemukan.",
  VALIDATION_ERROR: "Data yang dikirim belum sesuai.",
  LOCATION_REQUIRED: "Pilih wilayah atau atur jadwal manual dulu.",
  UNAUTHENTICATED: "Masuk dulu untuk melanjutkan.",
  PENDING_LOGIN_INVALID: "Waktu untuk melanjutkan sudah habis. Masuk lagi dengan kode baru.",
};

function parseDetail(detail: unknown): unknown {
  if (typeof detail !== "string" || detail === "") return undefined;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}

export const HTTP_STATUS: Record<ApiErrorCode, number> = {
  ENTITLEMENT_INACTIVE: 403,
  SESSION_LOCKED: 409,
  VERSION_CONFLICT: 409,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  OFFLINE: 503,
  NOT_AVAILABLE: 503,
  RATE_LIMITED: 429,
  UNAUTHENTICATED: 401,
  INVALID_OTP: 401,
  PENDING_LOGIN_INVALID: 400,
  FORBIDDEN_ORIGIN: 403,
  INTERNAL_ERROR: 500,
};

/** A database exception that carries one of our codes becomes an ApiError. Anything else returns null. */
export function mapDbError(e: unknown): ApiError | null {
  const err = e as { message?: unknown; detail?: unknown; code?: unknown };
  if (typeof err?.message !== "string" || !SQL_CODES.has(err.message)) return null;
  const detail = parseDetail(err.detail);
  const sqlCode = err.message;
  if (sqlCode === "VERSION_CONFLICT") {
    // The offline sender reads `details.server` to apply the user's tick again (src/offline/sender.ts).
    return new ApiError("VERSION_CONFLICT", MESSAGES.VERSION_CONFLICT!, { server: detail });
  }
  if (sqlCode === "LOCATION_REQUIRED") {
    return new ApiError("VALIDATION_ERROR", MESSAGES.LOCATION_REQUIRED!, { reason: "LOCATION_REQUIRED" });
  }
  return new ApiError(
    sqlCode as ApiErrorCode,
    MESSAGES[sqlCode]!,
    detail === undefined ? undefined : { reason: detail },
  );
}
