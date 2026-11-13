import { cn } from "@/lib/cn";

/** Text wordmark. Name: Munaja (M1). Stand-in until the owner supplies the NgajiGaes logo files. */
export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex flex-col leading-tight", className)}>
      <span className="text-[1.0625rem] font-bold">Munaja</span>
      {compact ? null : <span className="text-helper text-text-muted">oleh NgajiGaes</span>}
    </span>
  );
}
