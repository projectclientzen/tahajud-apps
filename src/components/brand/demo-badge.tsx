import { FlaskConical } from "lucide-react";
import { IS_DEMO } from "@/lib/env";
import { cn } from "@/lib/cn";

/** Required on every screen while mock data is active (PRD v1.2 §8.3). */
export function DemoBadge({ className }: { className?: string }) {
  if (!IS_DEMO) return null;
  return (
    <span
      role="note"
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full bg-highlight-soft px-2.5 text-helper font-medium text-text",
        className,
      )}
    >
      <FlaskConical aria-hidden className="size-4" />
      Data demo
    </span>
  );
}
