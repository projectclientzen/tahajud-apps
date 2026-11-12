"use client";

import * as React from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export function Section({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Anchor for the jump links at the top of the settings screen. */
  id?: string;
}) {
  return (
    <Card id={id} className="flex scroll-mt-4 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <CardTitle>{title}</CardTitle>
        {description ? <p className="text-text-muted">{description}</p> : null}
      </div>
      {children}
    </Card>
  );
}

export function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-12 items-center justify-between gap-4">
      <span className="flex flex-col">
        <span className="font-medium">{label}</span>
        {hint ? <span className="text-helper text-text-muted">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-6 shrink-0 accent-[var(--primary)]"
      />
    </label>
  );
}

const inputCls =
  "min-h-12 w-full min-w-0 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-text";

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="text-helper text-text-muted">{hint}</p> : null}
    </div>
  );
}

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...p }, ref) {
    return <input ref={ref} className={cn(inputCls, className)} {...p} />;
  },
);

export const SelectInput = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cn(inputCls, p.className)} />
);

export interface SaveState {
  kind: "idle" | "saved" | "error";
  text?: string;
}

export function SaveNote({ state }: { state: SaveState }) {
  if (state.kind === "idle") return null;
  return (
    <p
      role={state.kind === "error" ? "alert" : "status"}
      className={state.kind === "error" ? "text-error" : "text-text-muted"}
    >
      {state.text}
    </p>
  );
}
