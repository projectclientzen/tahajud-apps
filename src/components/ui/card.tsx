import * as React from "react";
import { cn } from "@/lib/cn";

type CardProps = React.HTMLAttributes<HTMLElement> & { as?: "section" | "article" | "div" };

export function Card({ as: Tag = "section", className, ...props }: CardProps) {
  return (
    <Tag
      className={cn("rounded-[var(--radius-card)] border border-border bg-surface p-5", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-card-title font-semibold", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-helper text-text-muted", className)} {...props} />;
}
