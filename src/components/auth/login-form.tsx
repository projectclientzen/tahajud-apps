"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { fieldClass } from "./auth-frame";
import { cooldownSeconds, otpRequestMessage } from "./otp-errors";
import { readPendingEmail, writePendingEmail } from "./pending-email";

/**
 * Step 1: email. The next screen is the same for every email, with or without access (AUTH-06),
 * so nobody can use this form to find out who has bought.
 */
export function LoginForm() {
  const router = useRouter();
  const { auth } = useAuth();
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const pending = readPendingEmail();
    if (pending) setEmail(pending.email);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth || busy) return;
    const clean = email.trim();
    if (!clean) {
      setError("Isi email dulu.");
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await auth.requestOtp(clean);
      writePendingEmail({ email: clean, resendAt: Date.now() + res.resend_after_seconds * 1000 });
      router.push("/auth/verify");
    } catch (err) {
      // A code was sent a moment ago: go to the code screen instead of leaving the user stuck here.
      const wait = cooldownSeconds(err);
      if (wait > 0) {
        writePendingEmail({ email: clean, resendAt: Date.now() + wait * 1000 });
        router.push("/auth/verify");
        return;
      }
      setError(otpRequestMessage(err));
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title font-bold">Masuk</h1>
        <p className="text-text-muted">Kami kirim kode 6 digit ke emailmu. Tanpa kata sandi.</p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="font-semibold">
          Email
        </label>
        <input
          ref={input}
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="nama@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "email-error email-help" : "email-help"}
          className={fieldClass}
        />
        <p id="email-help" className="text-helper text-text-muted">
          Pakai email yang sama dengan saat membeli di Scalev.
        </p>
        {error ? (
          <p id="email-error" role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-text">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="lg" block loading={busy} disabled={!auth}>
        Kirim kode
      </Button>
    </form>
  );
}
