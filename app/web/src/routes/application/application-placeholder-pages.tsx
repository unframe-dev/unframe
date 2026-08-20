function ApplicationPlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main id="main-content" className="app-main">
      <header className="page-heading">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
    </main>
  );
}

export function DevicesPage() {
  return (
    <ApplicationPlaceholderPage title="デバイス" description="接続済みのデバイスを管理します。" />
  );
}

export function RoomsPage() {
  return <ApplicationPlaceholderPage title="ルーム" description="参加できるルームを管理します。" />;
}
