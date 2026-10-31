import { cn } from "@/shared/lib/utils";
import styles from "./skeleton.module.css";

export function Skeleton({ className }: { className?: string | undefined }) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn("rounded-md bg-[var(--line)]", styles["skeleton"], className)}
    />
  );
}
