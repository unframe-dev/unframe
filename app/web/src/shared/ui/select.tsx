import { forwardRef, type ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

export const Select = forwardRef<HTMLSelectElement, ComponentProps<"select">>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "min-h-12 w-full rounded-md border bg-[var(--surface)] px-3 text-sm outline-none transition-colors focus:border-[var(--interactive-blue)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
