"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";

interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  /** bottom: sheet from the bottom on mobile, centred dialog from md up. center: always a dialog. */
  placement?: "bottom" | "center";
  children: React.ReactNode;
}

export function Sheet({ open, onOpenChange, trigger, title, description, placement = "bottom", children }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-[fade-in_var(--dur-base)_var(--ease-out)]" />
        <Dialog.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            "fixed z-50 flex max-h-[85dvh] flex-col gap-4 overflow-y-auto bg-surface p-6 text-text shadow-lg",
            placement === "bottom"
              ? "inset-x-0 bottom-0 rounded-t-[var(--radius-card)] pb-[max(1.5rem,env(safe-area-inset-bottom))] md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[min(32rem,calc(100vw-2rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[var(--radius-card)]"
              : "left-1/2 top-1/2 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-card)]",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-card-title font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="text-text-muted">{description}</Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              className="-m-2 grid size-11 shrink-0 place-items-center rounded-full text-text-muted hover:bg-surface-2"
              aria-label="Tutup"
            >
              <X aria-hidden className="size-5" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const SheetClose = Dialog.Close;
