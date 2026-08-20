import { forwardRef, type ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

export const Label = forwardRef<HTMLLabelElement, ComponentProps<"label">>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn("grid gap-2 text-sm font-medium", className)} {...props} />
  ),
);
Label.displayName = "Label";
