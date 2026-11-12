import { CircleAlert, Inbox, type LucideIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";

interface StateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}

function StateBlock({ title, description, action, icon: Icon, tone, role, className }: StateProps & { tone: string; role?: string }) {
  return (
    <div role={role} className={cn("flex flex-col items-start gap-3 rounded-[var(--radius-card)] p-5", tone, className)}>
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
