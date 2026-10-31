import type { ReactNode } from "react";
import { BrandLink } from "@/shared/brand/brand-link";
import styles from "@/shared/layouts/public-pages.module.css";

export function AuthLayout({
  title,
  description,
  className,
  decoration,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  decoration?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main id="main-content" className={`${styles["main"]} ${className ?? ""}`}>
      {decoration}
      <header className={styles["header"]}>
        <BrandLink />
      </header>
      <section className={styles["panel"]}>
        <header className={styles["copy"]}>
          <h1>{title}</h1>
          {description ? <p className={styles["lede"]}>{description}</p> : null}
        </header>
        <div className={styles["form"]}>{children}</div>
      </section>
    </main>
  );
}
