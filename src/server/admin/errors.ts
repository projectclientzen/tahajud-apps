import { ZodError } from "zod";
import { DbConfigError } from "@/server/db";

export type AdminErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "FORBIDDEN_ORIGIN"
  | "ADMIN_MFA_REQUIRED"
  | "MFA_SETUP_REQUIRED"
  | "INVALID_MFA_CODE"
  | "FOUR_EYES_REQUIRED"
  | "INVALID_TRANSITION"
  | "CONFLICT"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "NOT_AVAILABLE"
  | "INTERNAL_ERROR";

export const ADMIN_HTTP_STATUS: Record<AdminErrorCode, number> = {
  UNAUTHENTICATED: 401,
  ADMIN_MFA_REQUIRED: 401,
  MFA_SETUP_REQUIRED: 401,
  INVALID_MFA_CODE: 401,
  FORBIDDEN: 403,
  FORBIDDEN_ORIGIN: 403,
  FOUR_EYES_REQUIRED: 409,
  INVALID_TRANSITION: 409,
  CONFLICT: 409,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  NOT_AVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

const MESSAGES: Record<AdminErrorCode, string> = {
  UNAUTHENTICATED: "Masuk dulu untuk membuka admin.",
  FORBIDDEN: "Peran akunmu tidak boleh melakukan ini.",
  FORBIDDEN_ORIGIN: "Permintaan ini tidak berasal dari aplikasi.",
  ADMIN_MFA_REQUIRED: "Masukkan kode dari aplikasi autentikator.",
  MFA_SETUP_REQUIRED: "Pasang autentikator dulu untuk membuka admin.",
  INVALID_MFA_CODE: "Kode tidak cocok atau sudah dipakai.",
  FOUR_EYES_REQUIRED: "Penyetuju harus orang lain, bukan pembuat draf.",
  INVALID_TRANSITION: "Langkah ini tidak bisa dilakukan dari status sekarang.",
  CONFLICT: "Data sudah berubah atau tidak memenuhi syarat.",
  NOT_FOUND: "Data tidak ditemukan.",
  VALIDATION_ERROR: "Data yang dikirim belum sesuai.",
  RATE_LIMITED: "Terlalu sering mencoba. Coba lagi sebentar.",
  NOT_AVAILABLE: "Server belum siap. Coba lagi sebentar.",
  INTERNAL_ERROR: "Terjadi gangguan di server.",
};

/** Same wire shape as the user API: { error: { code, message, details } }. */
export class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? MESSAGES[code]);
    this.name = "AdminError";
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

const DB_CODES = new Set<AdminErrorCode>([
  "FORBIDDEN",
  "FOUR_EYES_REQUIRED",
  "INVALID_TRANSITION",
  "CONFLICT",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "UNAUTHENTICATED",
]);

function parseDetail(detail: unknown): unknown {
  if (typeof detail !== "string" || detail === "") return undefined;
  try {
    return JSON.parse(detail);
  } catch {
    return undefined;
  }
}

/** A database exception whose message is one of our codes. Anything else is not ours: null. */
export function mapAdminDbError(e: unknown): AdminError | null {
  const err = e as { message?: unknown; detail?: unknown };
  if (typeof err?.message !== "string") return null;
  if (err.message === "AUDIT_IMMUTABLE") return new AdminError("FORBIDDEN", "Audit log tidak bisa diubah atau dihapus.");
  if (!DB_CODES.has(err.message as AdminErrorCode)) return null;
  return new AdminError(err.message as AdminErrorCode, undefined, parseDetail(err.detail));
}

/** Anything thrown becomes one AdminError. The cause of an unknown failure is logged by SQLSTATE only, never sent. */
export function toAdminError(e: unknown, path: string): AdminError {
  if (e instanceof AdminError) return e;
  if (e instanceof ZodError) {
    return new AdminError("VALIDATION_ERROR", undefined, {
      issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  if (e instanceof DbConfigError) {
    console.error("admin_config_error", { path, message: e.message });
    return new AdminError("NOT_AVAILABLE", "Server belum dikonfigurasi.");
  }
  const mapped = mapAdminDbError(e);
  if (mapped) return mapped;
  console.error("admin_error", { path, name: (e as Error)?.name, sqlstate: (e as { code?: string })?.code });
  return new AdminError("INTERNAL_ERROR");
}
