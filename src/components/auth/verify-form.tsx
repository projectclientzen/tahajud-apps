"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { errorMessage } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import type { DeviceLimitResponse } from "@/data";
import { describeDevice } from "@/lib/device-label";
import { DeviceLimitPanel } from "./device-limit-panel";
import { CS_WHATSAPP_URL, SCALEV_URL, fieldClass } from "./auth-shell";
import { recallLogin, rememberLogin, seedUserData } from "./seed-user";

const RESEND_SECONDS = 60;

/** Step 2: type the 6 digit code here, in the app. No link to open, so it works inside an installed iPhone app (AUTH-07). */
export function VerifyForm() {
  const { auth, refresh } = useAuth();
  const router = useRouter();
  const [email, setEmail] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [wait, setWait] = React.useState(RESEND_SECONDS);
  const [limit, setLimit] = React.useState<DeviceLimitResponse | null>(null);

  React.useEffect(() => {
    const r = recallLogin();
    if (r.email === "") router.replace("/login");
    else {
      setEmail(r.email);
      setNotice(r.notice);
    }
  }, [router]);

  React.useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth || !email) return;
    setBusy(true);
    setError(null);
    try {
      const res = await auth.verifyOtp(email, code, describeDevice());
      if (res.status === "device_limit") {
        // Right code, but 3 devices are active. The user picks one to remove, or cancels (PRD §24.1).
        setLimit(res);
        setBusy(false);
        return;
      }
      await seedUserData(res);
      await refresh();
      router.replace("/dashboard");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  async function resend() {
    if (!auth || !email) return;
    setError(null);
    try {
      const res = await auth.requestOtp(email);
      rememberLogin(email, res.message);
      setNotice(res.message);
      setWait(res.resend_after_seconds);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (email === null) return null;
  if (limit) return <DeviceLimitPanel limit={limit} />;
  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-1">
          <h1 className="text-page-title font-bold">Masukkan kode</h1>
          <p className="text-text-muted">{notice || "Kode 6 digit dikirim ke email kamu."}</p>
          <p className="break-all">{email}</p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="otp-code" className="font-semibold">
            Kode 6 digit
          </label>
          <input
            id="otp-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            pattern="[0-9]{6}"
            required
            className={`${fieldClass} text-center text-stat tracking-[0.3em] tabular-nums`}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            aria-describedby={error ? "otp-error" : undefined}
          />
        </div>
        {error ? (
          <p id="otp-error" role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" block loading={busy} disabled={!auth || code.length !== 6}>
          Masuk
        </Button>
      </form>

      <details className="rounded-[var(--radius-card)] border border-border p-4">
        <summary className="min-h-11 font-semibold">Tidak menerima kode?</summary>
        <div className="flex flex-col gap-3 pt-3">
          <ul className="list-disc pl-5 text-text-muted">
            <li>Cek folder spam atau promosi.</li>
            <li>Pastikan email sama dengan yang dipakai saat checkout di Scalev.</li>
            <li>Kode berlaku sebentar. Minta kode baru jika sudah lama.</li>
          </ul>
          <Button variant="secondary" onClick={resend} disabled={wait > 0}>
            {wait > 0 ? `Kirim ulang kode (${wait} detik)` : "Kirim ulang kode"}
          </Button>
          {CS_WHATSAPP_URL ? (
            <a href={CS_WHATSAPP_URL} className="min-h-11 py-2 font-semibold underline">
              Hubungi CS lewat WhatsApp
            </a>
          ) : (
            <p className="text-helper text-text-muted">Nomor WhatsApp CS menyusul.</p>
          )}
          {SCALEV_URL ? (
            <a href={SCALEV_URL} className="min-h-11 py-2 underline">
              Belum membeli? Beli di Scalev
            </a>
          ) : null}
        </div>
      </details>

      <button
        type="button"
        onClick={() => router.push("/login")}
        className="min-h-11 self-start rounded-[var(--radius-control)] px-2 font-semibold underline"
      >
        Ganti email
      </button>
    </div>
  );
}
