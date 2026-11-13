"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import type { DeviceLimitResponse } from "@/data";
import { isPlausibleEmail, normalizePhone, checkPassword, PASSWORD_PROBLEM_MESSAGE } from "@/domain/auth";
import { describeDevice } from "@/lib/device-label";
import { authErrorText, isCode } from "./auth-errors";
import { AuthLink, CsLink } from "./auth-links";
import { fieldClass } from "./auth-shell";
import { DeviceLimitPanel } from "./device-limit-panel";
import { PasswordField } from "./password-field";
import { seedUserData } from "./seed-user";

type Step = "identity" | "password" | "done";

const PASSWORD_HINT = "Minimal 10 karakter. Kalimat panjang lebih kuat daripada kata yang sulit diingat.";

/**
 * Account activation. Two steps on one page, but the server gets email, phone and password in ONE request, so there is
 * no answer in between that says whether the email and phone match (no oracle).
 */
export function ActivateForm() {
  const { auth, refresh } = useAuth();
  const router = useRouter();
  const [step, setStep] = React.useState<Step>("identity");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [limit, setLimit] = React.useState<DeviceLimitResponse | null>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);

  // A new step replaces the content: move focus to its heading so a screen reader announces it.
  React.useEffect(() => heading.current?.focus(), [step]);

  const problem = password === "" ? null : checkPassword(password, { email, phone });
  const mismatch = confirm !== "" && confirm !== password;

  function next(e: React.FormEvent) {
    e.preventDefault();
    if (!isPlausibleEmail(email)) return setError("Format email belum benar.");
    if (!normalizePhone(phone)) return setError("Nomor HP belum benar. Contoh: 0812 3456 7890.");
    setError(null);
    setFailed(false);
    setStep("password");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!auth || busy || problem || mismatch || password === "") return;
    setBusy(true);
    setError(null);
    try {
      const res = await auth.activate({ email, phone, password, deviceLabel: describeDevice() });
      if (res.status === "device_limit") {
        setLimit(res);
        setBusy(false);
        return;
      }
      await seedUserData(res);
      await refresh();
      setPassword("");
      setConfirm("");
      setStep("done");
    } catch (err) {
      setError(authErrorText(err));
      setFailed(isCode(err, "ACTIVATION_FAILED"));
      // Wrong data goes back to the first step so the user can fix it. A weak password stays here.
      if (isCode(err, "ACTIVATION_FAILED")) setStep("identity");
      setBusy(false);
    }
  }

  if (limit) return <DeviceLimitPanel limit={limit} />;

  if (step === "done") {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 ref={heading} tabIndex={-1} className="text-page-title font-bold">
            Akun aktif
          </h1>
          <p className="text-text-muted">Akun aktif untuk</p>
          <p data-testid="activated-email" className="break-all font-semibold">
            {email.trim().toLowerCase()}
          </p>
          <p className="text-text-muted">
            Kalau bukan kamu yang membuat akun ini, hubungi CS sekarang. Gunakan password barumu untuk masuk di
            perangkat lain.
          </p>
        </div>
        <Button size="lg" block onClick={() => router.replace("/dashboard")}>
          Lanjut ke aplikasi
        </Button>
        <CsLink />
      </div>
    );
  }

  if (step === "password") {
    return (
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-1">
          <h1 ref={heading} tabIndex={-1} className="text-page-title font-bold">
            Buat password
          </h1>
          <p className="text-text-muted">Untuk akun</p>
          <p className="break-all">{email.trim().toLowerCase()}</p>
        </div>
        <PasswordField
          id="act-password"
          label="Password baru"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={PASSWORD_HINT}
          error={problem ? PASSWORD_PROBLEM_MESSAGE[problem] : null}
        />
        <PasswordField
          id="act-confirm"
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
          Aktifkan akun
        </Button>
        <button
          type="button"
          onClick={() => setStep("identity")}
          className="min-h-11 self-start rounded-[var(--radius-control)] px-2 font-semibold underline"
        >
          Ganti email atau nomor HP
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={next} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <h1 ref={heading} tabIndex={-1} className="text-page-title font-bold">
          Aktivasi akun
        </h1>
        <p className="text-text-muted">
          Pakai email dan nomor HP yang sama dengan saat order di Scalev. Setelah itu kamu membuat password sendiri.
        </p>
      </div>
      {failed && error ? (
        <div role="alert" className="flex flex-col gap-1 rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
          <p>{error}</p>
          <p className="text-text">Pembayaran baru masuk? Tunggu beberapa menit, lalu coba lagi.</p>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <label htmlFor="act-email" className="font-semibold">
          Email
        </label>
        <input
          id="act-email"
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
        <label htmlFor="act-phone" className="font-semibold">
          Nomor HP
        </label>
        <input
          id="act-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          className={fieldClass}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-describedby="act-phone-hint"
        />
        <p id="act-phone-hint" className="text-helper text-text-muted">
          Boleh 0812..., +62812... atau 62812.... Nomor tidak dikirim ke mana pun selain untuk mencocokkan order.
        </p>
      </div>
      {error && !failed ? (
        <p role="alert" className="rounded-[var(--radius-control)] bg-error-soft p-3 text-error">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" block disabled={!auth || email.trim() === "" || phone.trim() === ""}>
        Lanjut
      </Button>
      <div className="flex flex-col">
        <AuthLink href="/login">Sudah punya akun? Masuk</AuthLink>
        {failed ? <AuthLink href="/forgot-password">Lupa password?</AuthLink> : null}
        {failed ? <CsLink /> : null}
      </div>
    </form>
  );
}
