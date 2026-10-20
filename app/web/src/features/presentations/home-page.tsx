import { PublicationList } from "./publication-list";
import styles from "@/app/shell/application-content.module.css";

export function HomePage() {
  return (
    <main id="main-content" className={styles["main"]}>
      <header className={styles["heading"]}>
        <h1>公開済み Dist</h1>
        <p>Presentation の最新の公開情報を確認します。</p>
      </header>
      <PublicationList />
    </main>
  );
}
