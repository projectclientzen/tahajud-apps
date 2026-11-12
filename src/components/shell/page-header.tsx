import * as React from "react";
import { LogOut } from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import { DemoBadge } from "@/components/brand/demo-badge";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 pb-6 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DemoBadge className="shrink-0 whitespace-nowrap" />
        <div className="flex items-center">
          {actions}
          {/* The sidebar has its own sign-out on desktop. Phones have no sidebar, so every header carries one. */}
          <span className="lg:hidden">
            <LogoutButton size="icon" aria-label="Keluar" className="size-11">
              <LogOut aria-hidden className="size-5" />
            </LogoutButton>
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title font-bold">{title}</h1>
        {description ? <p className="max-w-prose text-text-muted">{description}</p> : null}
      </div>
    </header>
  );
}
