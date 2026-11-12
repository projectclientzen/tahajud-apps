import {
  BellOff,
  CircleAlert,
  Hourglass,
  Inbox,
  LockKeyhole,
  TimerReset,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";

interface StateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}

function StateBlock({
  title,
  description,
  action,
  icon: Icon,
  tone,
  role,
  className,
}: StateProps & { tone: string; role?: string }) {
  return (
    <div
      role={role}
      className={cn("flex flex-col items-start gap-3 rounded-[var(--radius-card)] p-5", tone, className)}
    >
      {Icon ? <Icon aria-hidden className="size-7" strokeWidth={1.75} /> : null}
      <div className="flex flex-col gap-1">
        <h3 className="text-card-title font-semibold">{title}</h3>
        {description ? <p className="max-w-prose text-text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState(props: StateProps) {
  return <StateBlock icon={Inbox} {...props} tone="bg-surface-2 text-text" />;
}

export function ErrorState(props: StateProps) {
  return <StateBlock icon={CircleAlert} role="alert" {...props} tone="bg-error-soft text-text" />;
}

type PresetProps = Partial<Pick<StateProps, "title" | "description" | "action" | "className">>;

/** Login session ended. Progress is safe on the server; the user only needs to sign in again. */
export function SessionExpiredState({
  title = "Sesimu sudah berakhir",
  description = "Masuk lagi dengan email yang sama. Catatan ibadahmu tetap tersimpan.",
  ...rest
}: PresetProps) {
  return (
    <StateBlock
      icon={TimerReset}
      role="alert"
      title={title}
      description={description}
      tone="bg-info-soft text-text"
      {...rest}
    />
  );
}

/** Signed in, but this account or role cannot open the page. */
export function AccessDeniedState({
  title = "Halaman ini belum bisa kamu buka",
  description = "Akunmu belum punya akses ke halaman ini. Hubungi CS jika menurutmu ini keliru.",
  ...rest
}: PresetProps) {
  return (
    <StateBlock
      icon={LockKeyhole}
      role="alert"
      title={title}
      description={description}
      tone="bg-surface-2 text-text"
      {...rest}
    />
  );
}

/** The browser or OS blocked a permission (for example notifications). Gives a way forward. */
export function PermissionDeniedState({
  title = "Izin belum diberikan",
  description = "Browser memblokir izin ini. Buka pengaturan situs di browser, ubah izin, lalu muat ulang halaman.",
  ...rest
}: PresetProps) {
  return (
    <StateBlock
      icon={BellOff}
      role="alert"
      title={title}
      description={description}
      tone="bg-warning-soft text-text"
      {...rest}
    />
  );
}

/** Payment not verified yet (PRD §26). Calm wording: nothing is wrong with the user. */
export function PurchasePendingState({
  title = "Pembelianmu sedang diverifikasi",
  description = "Akses aktif setelah pembayaran terverifikasi. Biasanya tidak lama. Hubungi CS jika lebih dari satu hari.",
  ...rest
}: PresetProps) {
  return (
    <StateBlock
      icon={Hourglass}
      role="status"
      title={title}
      description={description}
      tone="bg-highlight-soft text-text"
      {...rest}
    />
  );
}

/** The data layer cannot be reached. New notes stay on the device. */
export function OfflineState({
  title = "Kamu sedang offline",
  description = "Catatan baru tersimpan di perangkat dan dikirim saat sinyal kembali.",
  ...rest
}: PresetProps) {
  return (
    <StateBlock
      icon={WifiOff}
      role="status"
      title={title}
      description={description}
      tone="bg-info-soft text-text"
      {...rest}
    />
  );
}
