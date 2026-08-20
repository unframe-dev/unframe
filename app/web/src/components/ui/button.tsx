import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";
import type { ComponentProps } from "react";

export const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-[color,background-color,border-color,box-shadow] duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]",
        outline:
          "border border-[var(--line-strong)] bg-[var(--surface)] text-[var(--foreground)] hover:border-[var(--interactive-blue)] hover:bg-[var(--interactive-blue-soft)] hover:text-[var(--interactive-blue-ink)]",
        ghost:
          "text-[var(--foreground)] hover:bg-[var(--interactive-blue-soft)] hover:text-[var(--interactive-blue-ink)]",
        destructive: "bg-[var(--destructive)] text-white hover:bg-[var(--destructive-hover)]",
      },
      size: { default: "h-11", sm: "h-9 px-4 text-xs", icon: "size-11 px-0" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<typeof BaseButton> & VariantProps<typeof buttonVariants>) {
  return <BaseButton className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
