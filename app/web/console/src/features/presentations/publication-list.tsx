import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/shared/ui/button";
import type { PublicationResult } from "./management-api";
import {
  presentationKeys,
  presentationsQueryOptions,
  publicationQueryOptions,
} from "./presentation-queries";
import { managementErrorMessage } from "./management-model";
import { PublicationCard } from "./publication-card";
import { PublicationListSkeleton } from "./publication-list-skeleton";
import cardStyles from "./publication-card.module.css";

const pageSize = 6;
export function PublicationList({ onSelect }: { onSelect?: (presentationId: string) => void }) {
  const [page, setPage] = useState(0);
  const queryClient = useQueryClient();
  const presentations = useQuery(presentationsQueryOptions(queryClient));
  const lastPage = Math.max(0, Math.ceil((presentations.data?.length ?? 0) / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const visible =
    presentations.data?.slice(currentPage * pageSize, (currentPage + 1) * pageSize) ?? [];
  const publications = useQueries({
    queries: visible.map((presentation) => ({
      ...publicationQueryOptions(presentation.id),
      enabled: !presentations.isError,
    })),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: presentationKeys.all });
  const fetching = presentations.isFetching || publications.some((query) => query.isFetching);
  return (
    <section className="grid gap-5 py-8" aria-label="公開済みプレゼンテーション一覧">
      <div>
        <Button variant="outline" disabled={fetching} onClick={() => void refresh()}>
          公開情報を再取得
        </Button>
      </div>
      {presentations.isPending ? (
        <PublicationListSkeleton
          count={pageSize}
          selection={Boolean(onSelect)}
          label="プレゼンテーションを読み込んでいます…"
        />
      ) : null}
      {presentations.isError ? (
        <p role="alert">{managementErrorMessage(presentations.error)}</p>
      ) : null}
      {presentations.isSuccess && presentations.data.length === 0 ? (
        <p>プレゼンテーションがありません。</p>
      ) : null}
      {!presentations.isError && (
        <div className={onSelect ? "grid gap-5" : cardStyles["grid"]}>
          {visible.map((presentation, index) => {
            const query = publications[index]!;
            if (query.isPending) {
              return (
                <PublicationListSkeleton
                  key={presentation.id}
                  count={1}
                  selection={Boolean(onSelect)}
                  label={`${presentation.name}の公開情報を読み込んでいます…`}
                  className="h-full"
                />
              );
            }
            const item: PublicationResult = query.isError
              ? { presentation, state: "error", error: query.error }
              : query.data
                ? { presentation, state: "published", publication: query.data }
                : { presentation, state: "unpublished" };
            return !onSelect ? (
              <PublicationCard
                key={presentation.id}
                item={item}
                refreshedAt={query.dataUpdatedAt}
              />
            ) : (
              <PublicationSelectionRow key={presentation.id} item={item} onSelect={onSelect} />
            );
          })}
        </div>
      )}
      {presentations.data && presentations.data.length > pageSize ? (
        <nav aria-label="プレゼンテーションのページ" className="flex items-center gap-4">
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

function PublicationSelectionRow({
  item,
  onSelect,
}: {
  item: PublicationResult;
  onSelect: (presentationId: string) => void;
}) {
  const { presentation } = item;
  return (
    <article className="flex flex-wrap items-center justify-between gap-4 border-b py-5">
      <div className="grid min-w-0 gap-2">
        <h2 className="break-words text-xl">{presentation.name}</h2>
        {item.state === "error" ? (
          <p role="alert">{managementErrorMessage(item.error)}</p>
        ) : item.state === "unpublished" ? (
          <p className="text-sm text-[var(--muted)]">未公開</p>
        ) : null}
      </div>
      {item.state === "published" ? (
        <div className="flex flex-wrap items-center gap-4">
          <Link
            to="/presentations/$presentationId"
            params={{ presentationId: presentation.id }}
            aria-label={`${presentation.name}の詳細を見る`}
          >
            詳細を見る
          </Link>
          <Button
            variant="outline"
            aria-label={`${presentation.name}を選択`}
            onClick={() => onSelect(presentation.id)}
          >
            選択
          </Button>
        </div>
      ) : null}
    </article>
  );
}
