"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import type { DeviceLimitResponse } from "@/data";
import { checkPassword, PASSWORD_PROBLEM_MESSAGE } from "@/domain/auth";
import { describeDevice } from "@/lib/device-label";
import { authErrorText, isCode } from "./auth-errors";
import { AuthLink, CsLink } from "./auth-links";
import { DeviceLimitPanel } from "./device-limit-panel";
import { PasswordField } from "./password-field";
import { seedUserData } from "./seed-user";

/** The token lives in the URL fragment (`#t=...`): it never reaches server logs or the Referer header. */
function readToken(): string | null {
  const m = /(?:^#|&)t=([A-Za-z0-9_-]{20,256})/.exec(window.location.hash);
  return m ? m[1]! : null;
}

/**
 * Reset link from CS. Opening the page changes nothing: only the button sends the token, so a link scanner that
 * just opens the page cannot use it up. The link works once and expires.
 */
export function ResetForm() {
  const { auth, refresh } = useAuth();
  const router = useRouter();
  const [token, setToken] = React.useState<string | null | undefined>(undefined);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [invalid, setInvalid] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [limit, setLimit] = React.useState<DeviceLimitResponse | null>(null);

  React.useEffect(() => {
    const t = readToken();
    setToken(t);
    // Take the token out of the address bar and history right away.
    if (t) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const problem = password === "" ? null : checkPassword(password);
  const mismatch = confirm !== "" && confirm !== password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth || !token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await auth.setPasswordWithToken(token, password, describeDevice());
      if (res.status === "device_limit") {
        setLimit(res);
        setBusy(false);
        return;
      }
      await seedUserData(res);
      await refresh();
      router.replace("/dashboard");
    } catch (err) {
      setInvalid(isCode(err, "INVALID_TOKEN"));
      setError(authErrorText(err));
      setBusy(false);
    }
  }

  if (token === undefined) return null;
  if (limit) return <DeviceLimitPanel limit={limit} />;
  if (token === null || invalid) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-page-title font-bold">Tautan tidak berlaku</h1>
          <p className="text-text-muted">
            Tautan reset hanya bisa dipakai sekali dan ada masa berlakunya. Minta tautan baru ke CS.
          </p>
        </div>
        <CsLink />
        <AuthLink href="/login">Ke halaman masuk</AuthLink>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title font-bold">Buat password baru</h1>
        <p className="text-text-muted">Tautan dari CS. Setelah ini semua perangkat lain akan keluar.</p>
      </div>
      <PasswordField
        id="rs-password"
        label="Password baru"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint="Minimal 10 karakter."
        error={problem ? PASSWORD_PROBLEM_MESSAGE[problem] : null}
      />
      <PasswordField
        id="rs-confirm"
        label="Ulangi password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        error={mismatch ? "Password belum sama." : null}
      />
      {error ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        block
        loading={busy}
        disabled={!auth || password === "" || confirm === "" || Boolean(problem) || mismatch}
      >
        Simpan password
      </Button>
    </form>
  );
}
