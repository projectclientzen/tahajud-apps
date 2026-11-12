import { Check, CircleDashed, CircleDot, Clock, Pause, Radio, type LucideIcon } from "lucide-react";
import { DISPLAY_STATUS_LABEL, type DisplayStatus } from "@/domain/content/session-status";
import { cn } from "@/lib/cn";

const STYLE: Record<DisplayStatus, { icon: LucideIcon; className: string }> = {
  completed: { icon: Check, className: "bg-success-soft text-success" },
  partial: { icon: CircleDot, className: "bg-warning-soft text-warning" },
  missed: { icon: CircleDashed, className: "bg-surface-2 text-text-muted" },
  excused: { icon: Pause, className: "bg-info-soft text-info" },
  upcoming: { icon: Clock, className: "border border-border-strong text-text" },
  in_progress: { icon: Radio, className: "bg-primary-soft text-text" },
};

/** Status is carried by icon + label, never by colour alone (PRD v1.2 §7.6). */
export function StatusChip({ status, className }: { status: DisplayStatus; className?: string }) {
  const { icon: Icon, className: tone } = STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-helper font-medium",
        tone,
        className,
      )}
    >
      <Icon aria-hidden className="size-4" strokeWidth={2.25} />
      {DISPLAY_STATUS_LABEL[status]}
    </span>
  );
}

/** Icon-only form for dense grids such as the calendar. Pair it with an accessible name on the parent. */
export function StatusGlyph({ status, className }: { status: DisplayStatus; className?: string }) {
  const { icon: Icon } = STYLE[status];
  return <Icon aria-hidden className={cn("size-4", className)} strokeWidth={2.25} />;
}
