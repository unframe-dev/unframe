import { PublicationList } from "./publication-list";
import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@/shared/ui/button";
import styles from "@/app/shell/application-content.module.css";

export function HomePage() {
  return (
    <main id="main-content" className={styles["main"]}>
      <header className={styles["heading"]}>
        <h1>公開済みプレゼンテーション</h1>
        <div className="mt-6">
          <Link to="/publish" className={buttonVariants({ variant: "outline" })}>
            プレゼンテーションを公開
          </Link>
        </div>
      </header>
      <PublicationList />
    </main>
  );
}
