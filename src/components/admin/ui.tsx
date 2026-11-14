"use client";

import { Check, CircleAlert, Copy, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/feedback-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { errorText, type Loaded } from "./api";

export const inputClass =
  "min-h-12 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-body text-text";

export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-helper text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Heading + body block. Plain surface, one level of nesting at most. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-card-title font-semibold">{title}</h2>
          {description ? <p className="max-w-prose text-helper text-text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function PageTitle({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 pb-2">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-page-title font-bold">{title}</h1>
        {description ? <p className="max-w-prose text-text-muted">{description}</p> : null}
      </div>
      {actions}
    </header>
  );
}

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";
const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-text",
  good: "bg-success-soft text-success",
  warn: "bg-warning-soft text-warning",
  bad: "bg-error-soft text-error",
  info: "bg-info-soft text-info",
};
const TONE_ICON = { neutral: null, good: Check, warn: TriangleAlert, bad: CircleAlert, info: Info } as const;

/** A status is always a word. Colour and icon only repeat it. */
export function Tag({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  const Icon = TONE_ICON[tone];
  return (
    <span className={cn("inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-helper font-medium", TONE[tone])}>
      {Icon ? <Icon aria-hidden className="size-4" strokeWidth={2.25} /> : null}
      {children}
    </span>
  );
}

export function Notice({ tone = "info", children, role }: { tone?: Tone; children: React.ReactNode; role?: "alert" | "status" }) {
  return (
    <div role={role} className={cn("rounded-[var(--radius-control)] p-3", TONE[tone])}>
      {children}
    </div>
  );
}

/** Loading, error and ready in one place. `empty` says what to do when a list has no rows. */
export function Load<T>({
  state,
  children,
  rows = 3,
}: {
  state: Loaded<T>;
  children: (data: T) => React.ReactNode;
  rows?: number;
}) {
  if (state.loading && !state.data) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label="Memuat">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (state.error) {
    return (
      <ErrorState
        title="Data belum bisa dimuat"
        description={errorText(state.error)}
        action={
          <Button variant="secondary" onClick={state.reload}>
            Coba lagi
          </Button>
        }
      />
    );
  }
  return state.data === null ? null : <>{children(state.data)}</>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] bg-surface-2 p-5">
      <p className="font-semibold">{title}</p>
      {hint ? <p className="mt-1 max-w-prose text-text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * A change that needs a written reason. The button stays disabled until the reason has 10 characters, the same rule the
 * database enforces. `fields` adds inputs (for example an approval reference). Result and error show right here.
 */
export function ReasonForm({
  id,
  buttonLabel,
  intro,
  danger,
  fields = [],
  onSubmit,
  reasonLabel = "Alasan",
  onDone,
}: {
  id: string;
  buttonLabel: string;
  intro?: string;
  danger?: boolean;
  fields?: { key: string; label: string; hint?: string; required?: boolean }[];
  onSubmit: (v: { reason: string; extra: Record<string, string> }) => Promise<void>;
  reasonLabel?: string;
  onDone?: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [extra, setExtra] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const ready = reason.trim().length >= 10 && fields.every((f) => !f.required || (extra[f.key] ?? "").trim().length > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ reason: reason.trim(), extra });
      setDone(true);
      setReason("");
      setExtra({});
      onDone?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-busy={busy || undefined}>
      {intro ? <p className="max-w-prose text-text-muted">{intro}</p> : null}
      {fields.map((f) => (
        <Field key={f.key} id={`${id}-${f.key}`} label={f.label} hint={f.hint}>
          <input
            id={`${id}-${f.key}`}
            className={inputClass}
            value={extra[f.key] ?? ""}
            onChange={(e) => {
              setDone(false);
              setExtra((x) => ({ ...x, [f.key]: e.target.value }));
            }}
            aria-describedby={f.hint ? `${id}-${f.key}-hint` : undefined}
            autoComplete="off"
          />
        </Field>
      ))}
      <Field id={`${id}-reason`} label={reasonLabel} hint="Minimal 10 karakter. Tercatat di audit log bersama namamu.">
        <textarea
          id={`${id}-reason`}
          className={cn(inputClass, "min-h-24 py-2")}
          value={reason}
          onChange={(e) => {
            setDone(false);
            setReason(e.target.value);
          }}
          maxLength={500}
          aria-describedby={`${id}-reason-hint`}
        />
      </Field>
      {error ? (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      ) : null}
      {done ? (
        <Notice tone="good" role="status">
          Tersimpan dan tercatat di audit log.
        </Notice>
      ) : null}
      <div>
        <Button type="submit" variant={danger ? "danger" : "primary"} disabled={!ready} loading={busy}>
          {buttonLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * A secret link shown ONCE. It lives in this component's state only: no storage, no URL, no log. Closing or leaving
 * the page loses it, and the server cannot show it again (only its hash is stored).
 */
export function ShownOnce({ link, expiresAt, who, onClose }: { link: string; expiresAt: string; who: string; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      ref.current?.select();
    }
  }
  return (
    <div role="status" className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-highlight-soft p-4">
      <p className="font-semibold">Tautan untuk {who}</p>
      <p className="max-w-prose">
        Salin dan kirim lewat WhatsApp sekarang. Tautan ini tidak akan tampil lagi. Berlaku sampai {new Date(expiresAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" })} dan hanya bisa dipakai sekali.
      </p>
      <label htmlFor="shown-once-link" className="sr-only">
        Tautan atur password
      </label>
      <textarea id="shown-once-link" ref={ref} readOnly rows={3} className={cn(inputClass, "py-2 font-mono text-helper")} value={link} onFocus={(e) => e.currentTarget.select()} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={copy}>
          <Copy aria-hidden className="size-5" />
          {copied ? "Tersalin" : "Salin tautan"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Sudah dikirim, tutup
        </Button>
      </div>
    </div>
  );
}

export function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-14 flex-col justify-center gap-1 rounded-[var(--radius-control)] border border-border bg-surface px-4 py-3 hover:bg-surface-2"
    >
      {children}
    </Link>
  );
}

export function Definition({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-helper text-text-muted">{i.label}</dt>
          <dd className="min-w-0 break-words">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---- labels (one place, so a status reads the same on every screen) ----
export const ENTITLEMENT_LABEL: Record<string, { label: string; tone: Tone }> = {
  active: { label: "Aktif", tone: "good" },
  pending_verification: { label: "Menunggu verifikasi", tone: "warn" },
  suspended: { label: "Ditangguhkan", tone: "warn" },
  revoked: { label: "Dicabut", tone: "bad" },
  expired: { label: "Kedaluwarsa", tone: "neutral" },
};
export const QUARANTINE_LABEL: Record<string, string> = {
  unknown_variant: "Varian bukan produk Tahajud",
  missing_email: "Order tanpa email",
  missing_phone: "Order tanpa nomor HP",
  amount_below_min: "Nominal di bawah batas",
  order_canceled: "Order dibatalkan",
  spam_flag: "Ditandai spam oleh Scalev",
  post_payment_change: "Berubah setelah dibayar (refund atau batal)",
  needs_cs_review: "Email sudah punya akun, nomor HP tidak cocok (perlu CS)",
};
export const PAYMENT_LABEL: Record<string, string> = { paid: "Lunas", settled: "Lunas (settled)", unpaid: "Belum dibayar", pending: "Menunggu", canceled: "Dibatalkan", refunded: "Refund" };
export const VERIFIED_LABEL: Record<string, string> = { scalev_api: "Diverifikasi ke Scalev", admin_manual: "Disetujui manual admin (lama)" };

export function EntitlementTag({ status }: { status: string }) {
  const s = ENTITLEMENT_LABEL[status] ?? { label: status, tone: "neutral" as Tone };
  return <Tag tone={s.tone}>{s.label}</Tag>;
}
