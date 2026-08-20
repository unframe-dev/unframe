import { forwardRef, type ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "min-h-12 w-full rounded-md border bg-[var(--surface)] px-3 text-sm outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--interactive-blue)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
