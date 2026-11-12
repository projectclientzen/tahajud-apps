import { cn } from "@/lib/cn";

/** Text wordmark. Stand-in until the owner supplies the NgajiGaes logo files. */
export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex flex-col leading-tight", className)}>
      <span className="text-[1.0625rem] font-bold">Tahajud Tracker</span>
      {compact ? null : <span className="text-helper text-text-muted">by NgajiGaes</span>}
    </span>
  );
}
