import { ApiError } from "@/data";
import { errorMessage } from "@/components/providers/data-provider";

/** One line for the user. A rate limit says how long to wait, never which counter ran out. */
export function authErrorText(e: unknown): string {
  if (e instanceof ApiError && e.code === "RATE_LIMITED") {
    const secs = (e.details as { retry_after_seconds?: unknown } | undefined)?.retry_after_seconds;
    const mins = typeof secs === "number" ? Math.max(1, Math.ceil(secs / 60)) : null;
    return mins ? `Terlalu sering mencoba. Coba lagi dalam ${mins} menit.` : "Terlalu sering mencoba. Coba lagi sebentar.";
  }
  if (e instanceof ApiError && e.code === "OFFLINE") return "Tidak ada koneksi. Coba lagi saat online.";
  return errorMessage(e);
}

export const isCode = (e: unknown, code: ApiError["code"]): boolean => e instanceof ApiError && e.code === code;
