import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-pulse rounded-[var(--radius-control)] bg-primary-soft motion-reduce:animate-none",
        className,
      )}
    />
  );
}
