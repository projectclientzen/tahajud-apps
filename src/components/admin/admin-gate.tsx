"use client";

import { LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { createHttpAuthRepository } from "@/data/http";
import { describeDevice } from "@/lib/device-label";
import { cn } from "@/lib/cn";
import { adminFetch, AdminApiError, errorText } from "./api";
import { Field, Notice, Tag, inputClass } from "./ui";

export interface AdminMe {
  state: "ok";
  email: string;
  roles: string[];
  expires_at: string;
  nav: { href: string; label: string; perm: string | null }[];
  can: Record<string, boolean>;
}
type MeState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "anonymous" }
  | { state: "not_admin"; email: string }
  | { state: "mfa_setup_required"; email: string; roles: string[] }
  | { state: "mfa_required"; email: string; roles: string[] }
  | AdminMe;

const Ctx = React.createContext<AdminMe | null>(null);
/** Who is signed in as admin, what the menu shows, and what they may do. Decided by the server, only read here. */
export function useAdmin(): AdminMe {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useAdmin outside AdminGate");
  return v;
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  content_admin: "Admin konten",
  support_admin: "Admin CS",
  reporting_admin: "Admin laporan",
};

/** Every /admin page sits behind this. The server checks again on every call: this only decides what to show. */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const [me, setMe] = React.useState<MeState>({ state: "loading" });
  const load = React.useCallback(async () => {
    try {
      setMe(await adminFetch<MeState>("GET", "/me"));
    } catch (e) {
      setMe({ state: "error", message: errorText(e) });
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  if (me.state === "loading") {
    return (
      <Frame>
        <div role="status" aria-label="Memuat" className="flex flex-col gap-3">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Frame>
    );
  }
  if (me.state === "error") {
    return (
      <Frame>
        <Notice tone="bad" role="alert">
          {me.message}
        </Notice>
        <div>
          <Button variant="secondary" onClick={load}>
            Coba lagi
          </Button>
        </div>
      </Frame>
    );
  }
  if (me.state === "anonymous") return <Frame><AdminLogin onDone={load} /></Frame>;
  if (me.state === "not_admin") return <Frame><NotAdmin email={me.email} onDone={load} /></Frame>;
  if (me.state === "mfa_setup_required") return <Frame><MfaSetup email={me.email} onDone={load} /></Frame>;
  if (me.state === "mfa_required") return <Frame><MfaVerify email={me.email} onDone={load} /></Frame>;
  return (
    <Ctx.Provider value={me}>
      <Shell me={me} onSignedOut={load}>
        {children}
      </Shell>
    </Ctx.Provider>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <Wordmark />
        <Tag>Admin</Tag>
      </header>
      <main id="main" className="flex flex-1 flex-col gap-5 pb-12">
        {children}
      </main>
    </div>
  );
}

function useHeading() {
  const ref = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => ref.current?.focus(), []);
  return ref;
}

// ---------- step 1: the normal account sign-in (email + password) ----------
function AdminLogin({ onDone }: { onDone: () => Promise<void> }) {
  const heading = useHeading();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // The same sign-in as the app. It is not tied to the app's demo or live data mode.
      const res = await createHttpAuthRepository().login(email, password, `Admin ${describeDevice()}`.trim());
      if (res.status === "device_limit") {
        setError("Akun ini sudah dipakai di 3 perangkat. Keluarkan satu perangkat dari menu Pengaturan di aplikasi, lalu masuk lagi.");
        setBusy(false);
        return;
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Email atau password salah.");
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <h1 ref={heading} tabIndex={-1} className="text-page-title font-bold">
          Masuk admin
        </h1>
        <p className="text-text-muted">Pakai email dan password akunmu. Setelah itu kamu diminta kode autentikator.</p>
      </div>
      {error ? (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      ) : null}
      <Field id="adm-email" label="Email">
        <input id="adm-email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" required className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field id="adm-password" label="Password">
        <input id="adm-password" type="password" autoComplete="current-password" required className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" block loading={busy}>
        Lanjut
      </Button>
      <p className="text-helper text-text-muted">Lupa password? Minta tautan reset ke super admin.</p>
    </form>
  );
}

function NotAdmin({ email, onDone }: { email: string; onDone: () => Promise<void> }) {
  const heading = useHeading();
  return (
    <>
      <h1 ref={heading} tabIndex={-1} className="text-page-title font-bold">
        Akun ini bukan admin
      </h1>
      <p className="text-text-muted">{email} belum punya peran admin. Minta super admin menambahkannya, atau masuk dengan akun lain.</p>
      <SignOut onDone={onDone} label="Keluar dari akun ini" />
    </>
  );
}

function SignOut({ onDone, label = "Keluar", variant = "secondary" }: { onDone: () => Promise<void>; label?: string; variant?: "secondary" | "ghost" }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <div>
      <Button
        variant={variant}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await createHttpAuthRepository().logout();
          } catch {
            /* the cookie may be gone already */
          }
          await onDone();
          setBusy(false);
        }}
      >
        <LogOut aria-hidden className="size-5" />
        {label}
      </Button>
    </div>
  );
}

// ---------- step 2: authenticator app ----------
function CodeField({ id, onSubmit, busy, error, label }: { id: string; onSubmit: (code: string) => void; busy: boolean; error: string | null; label: string }) {
  const [code, setCode] = React.useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (/^\d{6}$/.test(code)) onSubmit(code);
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      {error ? (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      ) : null}
      <Field id={id} label={label} hint="6 angka dari aplikasi autentikator. Kode berganti tiap 30 detik.">
        <input id={id} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className={cn(inputClass, "tracking-widest tabular-nums")} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-describedby={`${id}-hint`} />
      </Field>
      <Button type="submit" block loading={busy} disabled={code.length !== 6}>
        Buka admin
      </Button>
    </form>
  );
}

function MfaVerify({ email, onDone }: { email: string; onDone: () => Promise<void> }) {
  const heading = useHeading();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 ref={heading} tabIndex={-1} className="text-page-title font-bold">
          Kode autentikator
        </h1>
        <p className="text-text-muted">Masuk sebagai {email}.</p>
      </div>
      <CodeField
        id="adm-code"
        label="Kode"
        busy={busy}
        error={error}
        onSubmit={async (code) => {
          setBusy(true);
          setError(null);
          try {
            await adminFetch("POST", "/mfa/verify", { code });
            await onDone();
          } catch (e) {
            setError(errorText(e));
            setBusy(false);
          }
        }}
      />
      <SignOut onDone={onDone} variant="ghost" label="Ganti akun" />
    </>
  );
}

function MfaSetup({ email, onDone }: { email: string; onDone: () => Promise<void> }) {
  const heading = useHeading();
  const [secret, setSecret] = React.useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState(false);

  async function begin() {
    setStarting(true);
    setError(null);
    try {
      setSecret(await adminFetch("POST", "/mfa/begin", {}));
    } catch (e) {
      setError(errorText(e));
    }
    setStarting(false);
  }
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 ref={heading} tabIndex={-1} className="text-page-title font-bold">
          Pasang autentikator
        </h1>
        <p className="max-w-prose text-text-muted">
          Admin wajib memakai kode dari aplikasi autentikator (Google Authenticator, Authy, 1Password, dan sejenisnya). Ini dilakukan sekali untuk {email}.
        </p>
      </div>
      {!secret ? (
        <>
          {error ? (
            <Notice tone="bad" role="alert">
              {error}
            </Notice>
          ) : null}
          <div>
            <Button onClick={begin} loading={starting}>
              Buat kunci autentikator
            </Button>
          </div>
        </>
      ) : (
        <>
          <ol className="flex list-decimal flex-col gap-3 pl-5">
            <li>
              Di aplikasi autentikator, pilih tambah akun lalu masukkan kunci ini secara manual:
              <p className="mt-2 break-all rounded-[var(--radius-control)] bg-surface-2 p-3 font-mono text-body tabular-nums" aria-label="Kunci autentikator">
                {secret.secret}
              </p>
            </li>
            <li>
              Di HP ini, kamu juga bisa{" "}
              <a className="font-semibold underline" href={secret.otpauth_uri}>
                membukanya langsung di aplikasi autentikator
              </a>
              .
            </li>
            <li>Masukkan kode 6 angka yang muncul di bawah. Kunci ini tidak akan tampil lagi.</li>
          </ol>
          <CodeField
            id="adm-setup-code"
            label="Kode pertama"
            busy={busy}
            error={error}
            onSubmit={async (code) => {
              setBusy(true);
              setError(null);
              try {
                await adminFetch("POST", "/mfa/confirm", { code });
                await onDone();
              } catch (e) {
                setError(errorText(e));
                setBusy(false);
              }
            }}
          />
        </>
      )}
    </>
  );
}

// ---------- the shell ----------
function isCurrent(path: string, href: string): boolean {
  return href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`);
}

function NavList({ me, path, onNavigate }: { me: AdminMe; path: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Menu admin">
      <ul className="flex flex-col gap-1">
        {me.nav.map((n) => {
          const current = isCurrent(path, n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                onClick={onNavigate}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center rounded-[var(--radius-control)] px-3",
                  current ? "bg-primary-soft font-semibold text-text" : "text-text-muted hover:bg-surface-2",
                )}
              >
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Shell({ me, onSignedOut, children }: { me: AdminMe; onSignedOut: () => Promise<void>; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = React.useState(false);
  const current = me.nav.find((n) => isCurrent(path, n.href))?.label ?? "Admin";
  const logout = async () => {
    try {
      await adminFetch("POST", "/logout", {});
    } catch (e) {
      if (!(e instanceof AdminApiError)) throw e;
    }
    await onSignedOut();
  };
  const identity = (
    <div className="flex flex-col gap-2">
      <p className="break-all text-helper text-text-muted">{me.email}</p>
      <div className="flex flex-wrap gap-1.5">
        {me.roles.map((r) => (
          <Tag key={r}>{ROLE_LABEL[r] ?? r}</Tag>
        ))}
      </div>
      <p className="text-helper text-text-muted">
        Sesi admin berakhir {new Date(me.expires_at).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} WIB.
      </p>
      <Button variant="secondary" onClick={logout}>
        <LogOut aria-hidden className="size-5" />
        Keluar dari admin
      </Button>
    </div>
  );
  return (
    <div className="min-h-dvh lg:pl-[var(--sidebar-width)]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-width)] flex-col gap-6 overflow-y-auto border-r border-border bg-surface px-4 py-6 lg:flex">
        <Link href="/admin" className="px-3">
          <Wordmark />
        </Link>
        <NavList me={me} path={path} />
        <div className="mt-auto">{identity}</div>
      </aside>
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2 lg:hidden">
        <span className="font-semibold">{current}</span>
        <Sheet
          open={open}
          onOpenChange={setOpen}
          title="Menu admin"
          trigger={
            <Button variant="ghost" size="icon" aria-label="Buka menu">
              <Menu aria-hidden className="size-6" />
            </Button>
          }
        >
          <NavList me={me} path={path} onNavigate={() => setOpen(false)} />
          {identity}
        </Sheet>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-[var(--content-max)] flex-col gap-8 px-4 py-6 pb-16 sm:px-6">
        {children}
      </main>
    </div>
  );
}
