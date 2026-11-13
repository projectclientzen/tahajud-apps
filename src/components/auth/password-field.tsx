"use client";

import { Eye, EyeOff } from "lucide-react";
import * as React from "react";
import { fieldClass } from "./auth-shell";

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  hint?: string;
  error?: string | null;
}

/** Password input with a show/hide button (44px target) and a hint that stays linked for screen readers. */
export function PasswordField({ id, label, value, onChange, autoComplete, hint, error }: Props) {
  const [shown, setShown] = React.useState(false);
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          className={`${fieldClass} pr-14`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Sembunyikan password" : "Tampilkan password"}
          aria-pressed={shown}
          className="absolute right-0 top-0 grid size-12 place-items-center rounded-[var(--radius-control)] text-text-muted hover:text-text"
        >
          {shown ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
        </button>
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-helper text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
