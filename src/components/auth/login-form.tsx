"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import type { DeviceLimitResponse } from "@/data";
import { describeDevice } from "@/lib/device-label";
import { authErrorText } from "./auth-errors";
import { AuthLink } from "./auth-links";
import { fieldClass } from "./auth-shell";
import { DeviceLimitPanel } from "./device-limit-panel";
import { PasswordField } from "./password-field";
import { seedUserData } from "./seed-user";

/** Email + password sign-in. Every failure reads the same, so nothing says whether an email has an account. */
export function LoginForm() {
  const { auth, status, session, refresh } = useAuth();
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [limit, setLimit] = React.useState<DeviceLimitResponse | null>(null);

  React.useEffect(() => {
    if (status === "signedIn" && !limit) router.replace("/dashboard");
  }, [status, router, limit]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await auth.login(email, password, describeDevice());
      if (res.status === "device_limit") {
        // Right password, but 3 devices are active. The user picks one to remove, or cancels (PRD §24.1).
        setLimit(res);
        setBusy(false);
        return;
      }
      await seedUserData(res);
      await refresh();
      router.replace("/dashboard");
    } catch (err) {
      setError(authErrorText(err));
      setBusy(false);
    }
  }

  if (limit) return <DeviceLimitPanel limit={limit} />;
  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title font-bold">Masuk</h1>
        <p className="text-text-muted">Pakai email yang sama dengan saat checkout.</p>
      </div>
      {session?.reason === "revoked" ? (
        <p role="status" className="rounded-[var(--radius-control)] bg-info-soft p-3 text-text">
          Perangkat ini dikeluarkan dari akunmu lewat perangkat lain. Masuk lagi dengan password untuk melanjutkan.
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
          autoComplete="username"
          autoCapitalize="none"
          required
          className={fieldClass}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <PasswordField
        id="login-password"
        label="Password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />
      {error ? (
        <p id="login-error" role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" block loading={busy} disabled={!auth || email.trim() === "" || password === ""}>
        Masuk
      </Button>
      <div className="flex flex-col">
        <AuthLink href="/forgot-password">Lupa password?</AuthLink>
        <AuthLink href="/activate">Baru beli? Aktivasi akun</AuthLink>
      </div>
    </form>
  );
}
