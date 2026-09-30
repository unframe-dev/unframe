import moduleStyles from "./application-content.module.css";

const styles = { heading: moduleStyles["heading"]!, main: moduleStyles["main"]! };

function ApplicationPlaceholderPage({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.heading}>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
    </main>
  );
}

export function DevicesPage() {
  return (
    <ApplicationPlaceholderPage description="接続済みのデバイスを管理します。" title="デバイス" />
  );
}

export function RoomsPage() {
  return <ApplicationPlaceholderPage description="参加できるルームを管理します。" title="ルーム" />;
}
