import { Skeleton } from "@/shared/ui/skeleton";
import styles from "./publication-card.module.css";

export function PublicationListSkeleton({
  count,
  selection,
  label,
  className,
}: {
  count: number;
  selection: boolean;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      className={className ?? (selection ? "grid gap-5" : styles["grid"])}
    >
      {Array.from({ length: count }, (_, index) =>
        selection ? (
          <article key={index} aria-hidden="true" className={styles["skeletonRow"]}>
            <Skeleton className={styles["skeletonRowTitle"]} />
            <div className={styles["skeletonRowActions"]}>
              <Skeleton className={styles["skeletonAction"]} />
              <Skeleton className={styles["skeletonButton"]} />
            </div>
          </article>
        ) : (
          <article key={index} aria-hidden="true" className={`${styles["card"]} h-full`}>
            <div className={styles["content"]}>
              <div className={styles["preview"]}>
                <Skeleton className={styles["skeletonPreview"]} />
              </div>
              <div className={styles["body"]}>
                <div className={styles["titleRow"]}>
                  <Skeleton className={styles["skeletonTitle"]} />
                  <Skeleton className={styles["skeletonBadge"]} />
                </div>
                <Skeleton className={styles["skeletonAction"]} />
              </div>
            </div>
          </article>
        ),
      )}
    </div>
  );
}
