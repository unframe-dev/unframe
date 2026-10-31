import { Link } from "@tanstack/react-router";
import { BrandLink } from "@/shared/brand/brand-link";
import { buttonVariants } from "@/shared/ui/button";
import publicStyles from "@/shared/layouts/public-pages.module.css";
import styles from "./not-found-page.module.css";

export function NotFoundPage() {
  return (
    <main id="main-content" className={styles["page"]}>
      <header className={publicStyles["header"]}>
        <BrandLink application />
      </header>
      <section className={styles["content"]} aria-labelledby="not-found-title">
        <p className={styles["code"]}>404</p>
        <h1 id="not-found-title" className={styles["title"]}>
          ページが見つかりません
        </h1>
        <p className={styles["description"]}>
          URL が間違っているか、ページが移動・削除された可能性があります。
        </p>
        <Link to="/home" className={buttonVariants({ variant: "outline" })}>
          ホームへ戻る
        </Link>
      </section>
    </main>
  );
}
