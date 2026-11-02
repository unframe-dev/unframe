import { Skeleton } from "@/shared/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@/shared/ui/button";
import {
  presentationKeys,
  presentationQueryOptions,
  publicationQueryOptions,
} from "./presentation-queries";
import { managementErrorMessage } from "./management-model";
import { PublicationDetails } from "./publication-details";
import styles from "@/app/shell/application-content.module.css";

export function PresentationPage({ presentationId }: { presentationId: string }) {
  const client = useQueryClient();
  const presentation = useQuery(presentationQueryOptions(presentationId));
  const publication = useQuery(publicationQueryOptions(presentationId));
  const error = presentation.error ?? publication.error;
  const pending = presentation.isPending || publication.isPending;
  return (
    <main id="main-content" className={styles["main"]}>
      <header className={styles["heading"]}>
        <h1>{presentation.data?.name ?? "公開済みプレゼンテーションの詳細"}</h1>
      </header>
      <section className="grid gap-5 py-8">
        <div>
          <Button
            variant="outline"
            disabled={presentation.isFetching || publication.isFetching}
            onClick={() =>
              void client.invalidateQueries({ queryKey: presentationKeys.detail(presentationId) })
            }
          >
            公開情報を再取得
          </Button>
        </div>
        {pending ? (
          <div role="status" aria-label="公開情報を読み込んでいます…" className="grid gap-5">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-5 w-24" />
          </div>
        ) : null}
        {error ? <p role="alert">{managementErrorMessage(error)}</p> : null}
        {!error && publication.data ? (
          <>
            <Link to="/rooms" search={{ presentationId }}>
              ルームを作成
            </Link>
            <PublicationDetails publication={publication.data} />
          </>
        ) : !error && !pending ? (
          <p>未公開</p>
        ) : null}
      </section>
    </main>
  );
}
