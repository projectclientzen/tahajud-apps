"use client";

import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { isPlausibleEmail, normalizePhone, checkPassword, PASSWORD_PROBLEM_MESSAGE } from "@/domain/auth";
import { authErrorText, isCode } from "./auth-errors";
import { AuthLink, CsLink } from "./auth-links";
import { fieldClass } from "./auth-shell";
import { PasswordField } from "./password-field";

/**
 * Forgot password without email: the same proof as activation (email + phone of the order), then a new password.
 * It signs every device out and does not sign this one in: the user logs in by hand afterwards.
 */
export function ForgotPasswordForm() {
  const { auth } = useAuth();
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const heading = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    if (done) heading.current?.focus();
  }, [done]);

  const problem = password === "" ? null : checkPassword(password, { email, phone });
  const mismatch = confirm !== "" && confirm !== password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth || busy) return;
    if (!isPlausibleEmail(email)) return setError("Format email belum benar.");
    if (!normalizePhone(phone)) return setError("Nomor HP belum benar. Contoh: 0812 3456 7890.");
    setBusy(true);
    setError(null);
    setFailed(false);
    try {
      await auth.resetPassword({ email, phone, newPassword: password });
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(authErrorText(err));
      setFailed(isCode(err, "ACTIVATION_FAILED"));
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 ref={heading} tabIndex={-1} className="text-page-title font-bold">
            Password diganti
          </h1>
          <p role="status" className="text-text-muted">
            Semua perangkat sudah keluar. Masuk dengan password barumu.
          </p>
        </div>
        <AuthLink href="/login">Ke halaman masuk</AuthLink>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title font-bold">Lupa password</h1>
        <p className="text-text-muted">
          Isi email dan nomor HP yang dipakai saat order, lalu buat password baru. Semua perangkat akan keluar.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="fp-email" className="font-semibold">
          Email
        </label>
        <input
          id="fp-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          required
          className={fieldClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="fp-phone" className="font-semibold">
          Nomor HP
        </label>
        <input
          id="fp-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          className={fieldClass}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <PasswordField
        id="fp-password"
        label="Password baru"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint="Minimal 10 karakter."
        error={problem ? PASSWORD_PROBLEM_MESSAGE[problem] : null}
      />
      <PasswordField
        id="fp-confirm"
        label="Ulangi password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        error={mismatch ? "Password belum sama." : null}
      />
      {error ? (
        <div role="alert" className="flex flex-col gap-1 rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
          <p>{error}</p>
          {failed ? <p className="text-text">Tidak cocok terus? CS bisa mengirim tautan reset lewat WhatsApp.</p> : null}
        </div>
      ) : null}
      <Button
        type="submit"
        size="lg"
        block
        loading={busy}
        disabled={
          !auth || email.trim() === "" || phone.trim() === "" || password === "" || confirm === "" || Boolean(problem) || mismatch
        }
      >
        Ganti password
      </Button>
      <div className="flex flex-col">
        <AuthLink href="/login">Kembali ke masuk</AuthLink>
        {failed ? <CsLink /> : null}
      </div>
    </form>
  );
}
