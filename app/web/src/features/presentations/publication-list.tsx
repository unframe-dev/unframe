import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/shared/ui/button";
import {
  listPresentations,
  loadPublications,
  type Presentation,
  type Publication,
} from "./management-api";
import { managementErrorMessage } from "./management-model";

const pageSize = 6;
export function PublicationList({
  onSelect,
}: {
  onSelect?: (presentation: Presentation, publication: Publication) => void;
}) {
  const [page, setPage] = useState(0);
  const queryClient = useQueryClient();
  const presentations = useQuery({
    queryKey: ["presentations"],
    queryFn: listPresentations,
    retry: false,
  });
  const lastPage = Math.max(0, Math.ceil((presentations.data?.length ?? 0) / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible =
    presentations.data?.slice(currentPage * pageSize, (currentPage + 1) * pageSize) ?? [];
  const publications = useQuery({
    queryKey: ["publications", visible.map((item) => item.id)],
    queryFn: ({ signal }) => loadPublications(visible, signal),
    enabled: presentations.isSuccess && visible.length > 0,
    retry: false,
  });
  const refresh = async () => {
    await presentations.refetch();
    await queryClient.invalidateQueries({ queryKey: ["publications"] });
  };
  return (
    <section className="grid gap-5 py-8" aria-label="公開済み Dist 一覧">
      <div>
        <Button
          variant="outline"
          disabled={presentations.isFetching || publications.isFetching}
          onClick={() => void refresh()}
        >
          公開情報を再取得
        </Button>
      </div>
      {presentations.isPending ? <p role="status">Presentation を読み込んでいます…</p> : null}
      {presentations.isError ? (
        <p role="alert">{managementErrorMessage(presentations.error)}</p>
      ) : null}
      {presentations.isSuccess && presentations.data.length === 0 ? (
        <p>Presentation がありません。</p>
      ) : null}
      {visible.length > 0 && publications.isPending ? (
        <p role="status">公開情報を読み込んでいます…</p>
      ) : null}
      {publications.isError ? (
        <p role="alert">{managementErrorMessage(publications.error)}</p>
      ) : null}
      {!presentations.isError &&
        !publications.isError &&
        publications.data?.map((item) => (
          <article key={item.presentation.id} className="grid gap-3 border-b py-5">
            <h2 className="text-xl">{item.presentation.name}</h2>
            <p className="break-all text-sm">Presentation ID: {item.presentation.id}</p>
            {item.state === "error" ? (
              <p role="alert">{managementErrorMessage(item.error)}</p>
            ) : item.state === "unpublished" ? (
              <p>公開済み Dist なし</p>
            ) : (
              <>
                <p className="break-all text-sm">Build ID: {item.publication.buildId}</p>
                <p className="text-sm">Publication epoch: {item.publication.publicationEpoch}</p>
                <Link
                  to="/presentations/$presentationId"
                  params={{ presentationId: item.presentation.id }}
                >
                  公開済み Dist の詳細
                </Link>
                {onSelect ? (
                  <Button
                    variant="outline"
                    onClick={() => onSelect(item.presentation, item.publication)}
                  >
                    この公開版からルームを作成
                  </Button>
                ) : null}
              </>
            )}
          </article>
        ))}
      {presentations.data && presentations.data.length > pageSize ? (
        <nav aria-label="Presentation ページ" className="flex items-center gap-4">
          <Button
            variant="outline"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            前へ
          </Button>
          <span>
            {currentPage + 1} / {Math.ceil(presentations.data.length / pageSize)}
          </span>
          <Button
            variant="outline"
            disabled={(currentPage + 1) * pageSize >= presentations.data.length}
            onClick={() => setPage(currentPage + 1)}
          >
            次へ
          </Button>
        </nav>
      ) : null}
    </section>
  );
}
