import * as React from "react";
import { DemoBadge } from "@/components/brand/demo-badge";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 pb-6 pt-2">
      <div className="flex items-center justify-between gap-3">
        <DemoBadge />
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title font-bold">{title}</h1>
        {description ? <p className="max-w-prose text-text-muted">{description}</p> : null}
      </div>
    </header>
  );
}
