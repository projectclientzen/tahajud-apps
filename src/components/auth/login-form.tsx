"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { errorMessage } from "@/components/providers/data-provider";
import { Button } from "@/components/ui/button";
import { fieldClass } from "./auth-shell";
import { rememberLogin } from "./seed-user";

/** Step 1 of OTP sign-in. The answer is the same for every email (AUTH-06): nothing says whether it has access. */
export function LoginForm() {
  const { auth, status, session } = useAuth();
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (status === "signedIn") router.replace("/dashboard");
  }, [status, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth) return;
    setBusy(true);
    setError(null);
    try {
      const res = await auth.requestOtp(email);
      rememberLogin(email.trim(), res.message);
      router.push("/auth/verify");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title font-bold">Masuk</h1>
        <p className="text-text-muted">Pakai email yang sama dengan saat checkout. Kami kirim kode 6 digit ke sana.</p>
      </div>
      {session?.reason === "revoked" ? (
        <p role="status" className="rounded-[var(--radius-control)] bg-info-soft p-3 text-text">
          Perangkat ini dikeluarkan dari akunmu lewat perangkat lain. Masuk lagi dengan kode email untuk melanjutkan.
          Catatan ibadahmu tidak hilang.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <label htmlFor="login-email" className="font-semibold">
          Email
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          className={fieldClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-describedby={error ? "login-error" : undefined}
        />
      </div>
      {error ? (
        <p id="login-error" role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" block loading={busy} disabled={!auth || email.trim() === ""}>
        Kirim kode
      </Button>
    </form>
  );
}
