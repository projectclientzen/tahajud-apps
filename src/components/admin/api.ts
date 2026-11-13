"use client";

import * as React from "react";

/** One error shape for every admin call. `code` is the server code (FORBIDDEN, FOUR_EYES_REQUIRED, ...). */
export class AdminApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

const BASE = "/api/v1/admin";

/** Same origin, cookie sent by the browser, JSON in and out. Nothing is kept in storage. */
export async function adminFetch<T = unknown>(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AdminApiError("NETWORK", "Tidak bisa terhubung ke server. Cek koneksi lalu coba lagi.", 0);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new AdminApiError(e?.code ?? "UNKNOWN", e?.message ?? "Terjadi gangguan di server.", res.status, e?.details);
  }
  return json as T;
}

/** Why a call failed, in words for the screen. Details of validation are added when the server sent them. */
export function errorText(e: unknown): string {
  if (e instanceof AdminApiError) {
    const reason = (e.details as { reason?: string; field?: string } | undefined)?.reason;
    const hint = REASONS[reason ?? ""];
    return hint ? `${e.message} ${hint}` : e.message;
  }
  return "Terjadi gangguan. Coba lagi.";
}

const REASONS: Record<string, string> = {
  too_short: "Alasan minimal 10 karakter.",
  required: "Kolom ini wajib diisi.",
  account_exists: "Email ini sudah punya akun.",
  email_has_entitlement: "Email ini sudah punya akses dari pembelian.",
  no_account: "Pembeli ini belum punya akun. Minta dia aktivasi dulu.",
  order_email_missing: "Order ini tidak punya email, jadi belum bisa disetujui.",
  super_admin_exists: "Sudah ada super_admin.",
  stale_draft: "Konten live sudah berubah sejak draf ini dibuat.",
  no_changes: "Draf belum berbeda dari versi live.",
  arabic_not_allowed: "Teks Arab tidak bisa diisi dari admin.",
  not_editable: "Kolom ini tidak bisa diubah dari admin.",
  draft_owned_by_other: "Draf ini milik admin lain.",
  last_super_admin: "Ini super_admin terakhir.",
  cannot_reset_self: "Tidak bisa mereset diri sendiri.",
};

export interface Loaded<T> {
  data: T | null;
  error: AdminApiError | null;
  loading: boolean;
  reload: () => void;
}

/** GET on mount and whenever `path` changes. `null` path = do not load. A newer call wins over an older one. */
export function useAdminGet<T>(path: string | null): Loaded<T> {
  const [state, setState] = React.useState<{ data: T | null; error: AdminApiError | null; loading: boolean }>({
    data: null,
    error: null,
    loading: path !== null,
  });
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    if (path === null) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    adminFetch<T>("GET", path).then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e: unknown) =>
        live &&
        setState({ data: null, error: e instanceof AdminApiError ? e : new AdminApiError("UNKNOWN", errorText(e), 0), loading: false }),
    );
    return () => {
      live = false;
    };
  }, [path, tick]);
  const reload = React.useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export const fmtDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) : "-";

export const fmtMoney = (amount: number | string | null | undefined, currency = "IDR"): string =>
  amount === null || amount === undefined || amount === ""
    ? "-"
    : new Intl.NumberFormat("id-ID", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(amount));
