import { PublicationList } from "./publication-list";
import styles from "@/app/shell/application-content.module.css";

export function HomePage() {
  return (
    <main id="main-content" className={styles["main"]}>
      <header className={styles["heading"]}>
        <h1>公開済みプレゼンテーション</h1>
      </header>
      <PublicationList />
    </main>
  );
}
