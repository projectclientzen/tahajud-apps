import { ApiError } from "@/data";

/** Friendly sentence for a failed OTP request. Rate limits say when to try again. */
export function otpRequestMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "VALIDATION_ERROR") return "Format email belum benar. Contoh: nama@email.com";
    if (e.code === "RATE_LIMITED") {
      const secs = Number((e.details as { retry_after_seconds?: number } | undefined)?.retry_after_seconds ?? 0);
      if (secs > 0) {
        const wait = secs >= 90 ? `${Math.ceil(secs / 60)} menit` : `${secs} detik`;
        return `Terlalu sering meminta kode. Coba lagi dalam ${wait}.`;
      }
      return "Terlalu sering meminta kode. Coba lagi sebentar lagi.";
    }
    if (e.code === "OFFLINE") return "Kamu sedang offline. Hubungkan internet, lalu coba lagi.";
  }
  return "Kode belum bisa dikirim. Cek koneksi, lalu coba lagi.";
}

/** Seconds to wait when the server says "cooldown". Zero for any other error. */
export function cooldownSeconds(e: unknown): number {
  if (!(e instanceof ApiError) || e.code !== "RATE_LIMITED") return 0;
  const d = e.details as { reason?: string; retry_after_seconds?: number } | undefined;
  return d?.reason === "cooldown" ? Number(d.retry_after_seconds ?? 0) : 0;
}
