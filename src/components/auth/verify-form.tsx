"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { ApiError, type DeviceLimitResponse } from "@/data";
import { describeDevice } from "@/lib/device-label";
import { fieldClass } from "./auth-frame";
import { CsWhatsappButton } from "./cs-whatsapp-button";
import { DeviceLimitPanel } from "./device-limit-panel";
import { cooldownSeconds, otpRequestMessage } from "./otp-errors";
import { clearPendingEmail, readPendingEmail, writePendingEmail, type PendingEmail } from "./pending-email";

const GENERIC = "Jika email ini punya akses, kode 6 digit sudah dikirim. Cek juga folder spam.";
const BAD_CODE = "Kode tidak valid atau sudah kedaluwarsa.";

/** Step 2: the 6-digit code, typed here. No link to open, so it works inside an installed app on iPhone too. */
export function VerifyForm() {
  const router = useRouter();
  const { auth, refresh } = useAuth();
  const [pending, setPending] = React.useState<PendingEmail | null>(null);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string>(GENERIC);
  const [limit, setLimit] = React.useState<DeviceLimitResponse | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const [resending, setResending] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const submitted = React.useRef<string>("");

  React.useEffect(() => {
    const p = readPendingEmail();
    if (!p) {
      router.replace("/login");
      return;
    }
    setPending(p);
  }, [router]);

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const wait = pending ? Math.max(0, Math.ceil((pending.resendAt - now) / 1000)) : 0;

  const verify = React.useCallback(
    async (value: string) => {
      if (!auth || !pending || busy || submitted.current === value) return;
      submitted.current = value;
      setBusy(true);
      setError(null);
      try {
        const res = await auth.verifyOtp(pending.email, value, describeDevice());
        if (res.status === "device_limit") {
          setLimit(res);
          return;
        }
        clearPendingEmail();
        await refresh();
        router.replace("/dashboard");
      } catch (e) {
        submitted.current = "";
        setError(
          e instanceof ApiError && e.code === "INVALID_OTP" ? BAD_CODE : "Belum bisa memeriksa kode. Coba lagi.",
        );
        setCode("");
        input.current?.focus();
      } finally {
        setBusy(false);
      }
    },
    [auth, pending, busy, refresh, router],
  );

  function onChange(raw: string) {
    // Paste "123 456" or "123-456" and it still works.
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setError(null);
    if (digits.length === 6) void verify(digits);
  }

  async function resend() {
    if (!auth || !pending || resending) return;
    setResending(true);
    setError(null);
    try {
      const res = await auth.requestOtp(pending.email);
      const next = { email: pending.email, resendAt: Date.now() + res.resend_after_seconds * 1000 };
      writePendingEmail(next);
      setPending(next);
      setNow(Date.now());
      submitted.current = "";
      setNotice("Kode baru sudah dikirim. Kode lama tidak berlaku lagi.");
    } catch (e) {
      const cd = cooldownSeconds(e);
      if (cd > 0 && pending) {
        const next = { email: pending.email, resendAt: Date.now() + cd * 1000 };
        writePendingEmail(next);
        setPending(next);
      }
      setError(otpRequestMessage(e));
    } finally {
      setResending(false);
    }
  }

  if (limit) return <DeviceLimitPanel limit={limit} />;
  if (!pending) return null;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) void verify(code);
        else {
          setError("Kode terdiri dari 6 angka.");
          input.current?.focus();
        }
      }}
      noValidate
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title font-bold">Masukkan kode</h1>
        <p className="text-text-muted">
          Kode untuk <span className="break-all font-semibold text-text">{pending.email}</span>
        </p>
        <p role="status" className="text-helper text-text-muted">
          {notice}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="otp" className="font-semibold">
          Kode 6 digit
        </label>
        <input
          ref={input}
          id="otp"
          name="otp"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={14}
          value={code}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "otp-error" : undefined}
          className={`${fieldClass} text-center text-[1.75rem] font-semibold tracking-[0.35em] tabular-nums`}
          autoFocus
        />
        {error ? (
          <p id="otp-error" role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-text">
            {error}
          </p>
        ) : null}
      </div>

      <Button type="submit" size="lg" block loading={busy}>
        Masuk
      </Button>

      <details className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <summary className="min-h-11 cursor-pointer font-semibold marker:text-text-muted">Tidak menerima kode?</summary>
        <div className="mt-3 flex flex-col gap-4">
          <ul className="list-disc space-y-2 pl-5">
            <li>Cek folder spam atau promosi di emailmu.</li>
            <li>Pastikan emailnya sama dengan email yang kamu pakai saat checkout di Scalev.</li>
            <li>Kode bisa dikirim ulang setelah 60 detik.</li>
          </ul>
          <Button type="button" variant="secondary" block disabled={wait > 0} loading={resending} onClick={resend}>
            {wait > 0 ? `Kirim ulang kode (${wait} dtk)` : "Kirim ulang kode"}
          </Button>
          <CsWhatsappButton message="Halo CS Tahajud Tracker, saya tidak menerima kode masuk." />
        </div>
      </details>

      <Button
        type="button"
        variant="ghost"
        block
        onClick={() => {
          clearPendingEmail();
          router.push("/login");
        }}
      >
        Pakai email lain
      </Button>
    </form>
  );
}
