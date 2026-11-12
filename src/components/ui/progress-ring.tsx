import * as React from "react";
import { cn } from "@/lib/cn";

interface ProgressRingProps {
  value: number;
  max: number;
  label: string;
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
  className?: string;
}

export function ProgressRing({ value, max, label, size = 160, stroke = 10, children, className }: ProgressRingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value} dari ${max}`}
      className={cn("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-2" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          className="stroke-primary transition-[stroke-dashoffset] duration-[var(--dur-base)] ease-[var(--ease-out)]"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
