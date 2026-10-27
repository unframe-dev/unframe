import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@/shared/ui/button";
import { getPresentation, getPublication } from "./management-api";
import { managementErrorMessage } from "./management-model";
import { PublicationDetails } from "./publication-details";
import styles from "@/app/shell/application-content.module.css";

export function PresentationPage({ presentationId }: { presentationId: string }) {
  const query = useQuery({
    queryKey: ["presentation", presentationId],
    retry: false,
    queryFn: async () => ({
      presentation: await getPresentation(presentationId),
      publication: await getPublication(presentationId),
    }),
  });
  return (
    <main id="main-content" className={styles["main"]}>
      <header className={styles["heading"]}>
        <h1>{query.data?.presentation.name ?? "公開済み Dist の詳細"}</h1>
        <p>Presentation ID: {presentationId}</p>
      </header>
      <section className="grid gap-5 py-8">
        <div>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            公開情報を再取得
          </Button>
        </div>
        {query.isPending ? <p role="status">公開情報を読み込んでいます…</p> : null}
        {query.isError ? <p role="alert">{managementErrorMessage(query.error)}</p> : null}
        {query.data?.publication ? (
          <>
            <PublicationDetails publication={query.data.publication} />
            <Link to="/rooms" search={{ presentationId }}>
              この Presentation でルームを作成
            </Link>
          </>
        ) : query.isSuccess ? (
          <p>公開済み Dist なし</p>
        ) : null}
      </section>
    </main>
  );
}
