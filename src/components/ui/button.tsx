import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  [
    "inline-flex select-none items-center justify-center gap-2 font-semibold",
    "rounded-[var(--radius-control)] transition-[background-color,color,border-color,transform]",
    "duration-[var(--dur-fast)] ease-[var(--ease-out)] active:scale-[0.98]",
    "disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-text disabled:border-transparent disabled:active:scale-100",
    "aria-busy:cursor-progress",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary hover:bg-primary/90",
        secondary: "border border-border-strong bg-surface text-text hover:bg-surface-2",
        ghost: "text-text hover:bg-surface-2",
        danger: "bg-error text-on-primary hover:bg-error/90",
      },
      size: {
        md: "min-h-12 px-5 text-body",
        lg: "min-h-14 px-6 text-[1.0625rem]",
        icon: "size-12 p-0",
      },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  block,
  asChild,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && !asChild ? (
        <>
          <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

export { buttonVariants };
