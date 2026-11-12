import { cn } from "@/lib/cn";

interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  /** Text shown to sighted users and announced as aria-valuetext. */
  valueText?: string;
  className?: string;
}

/** Fill animates with transform (scaleX), never width. */
export function ProgressBar({ value, max, label, valueText, className }: ProgressBarProps) {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.min(Math.max(value / safeMax, 0), 1);
  const text = valueText ?? `${value} dari ${max}`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-helper">
        <span className="text-text">{label}</span>
        <span className="tabular-nums text-text-muted">{text}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        className="h-2.5 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className="h-full origin-left rounded-full bg-primary transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)]"
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
    </div>
  );
}
