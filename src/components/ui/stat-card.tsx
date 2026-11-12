import * as React from "react";
import { cn } from "@/lib/cn";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function StatCard({ label, value, hint, icon, className }: StatCardProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-[var(--radius-card)] bg-surface-2 p-4", className)}>
      <div className="flex items-center gap-2 text-helper text-text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-stat font-semibold tabular-nums">{value}</div>
      {hint ? <p className="text-helper text-text-muted">{hint}</p> : null}
    </div>
  );
}
