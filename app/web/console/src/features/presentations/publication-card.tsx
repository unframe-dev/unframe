import { ImageIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { sessionQuery } from "@/features/auth/control-plane-auth";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Skeleton } from "@/shared/ui/skeleton";
import { publicationThumbnailUrl, type PublicationResult } from "./management-api";
import { managementErrorMessage } from "./management-model";
import styles from "./publication-card.module.css";

function ThumbnailPlaceholder() {
  return (
    <div className={styles["placeholder"]}>
      <ImageIcon aria-hidden="true" size={24} />
      <span>サムネイルなし</span>
    </div>
  );
}

type ThumbnailState = { status: "loading" | "loaded" } | { status: "error"; refreshedAt: number };

function Thumbnail({ src, name, refreshedAt }: { src: string; name: string; refreshedAt: number }) {
  const client = useQueryClient();
  const [state, setState] = useState<ThumbnailState>({ status: "loading" });
  const loading = state.status !== "loaded";
  return state.status === "error" && state.refreshedAt === refreshedAt ? (
    <ThumbnailPlaceholder />
  ) : (
    <div className={styles["thumbnail"]}>
      <img
        className={styles["image"]}
        data-loading={loading}
        src={src}
        alt={`${name}のサムネイル`}
        loading="lazy"
        decoding="async"
        crossOrigin="use-credentials"
        referrerPolicy="no-referrer"
        onLoad={() => setState({ status: "loaded" })}
        onError={() => {
          setState({ status: "error", refreshedAt });
          void client.fetchQuery({ ...sessionQuery, staleTime: 0 }).catch(() => undefined);
        }}
      />
      {loading ? (
        <div
          className={styles["thumbnailLoading"]}
          role="status"
          aria-label={`${name}のサムネイルを読み込んでいます…`}
          aria-busy="true"
        >
          <Skeleton className={styles["skeletonPreview"]} />
        </div>
      ) : null}
    </div>
  );
}

export function PublicationCard({
  item,
  refreshedAt,
}: {
  item: PublicationResult;
  refreshedAt: number;
}) {
  const { presentation } = item;
  return (
    <article className={styles["card"]} data-interactive="true">
      <Link
        className={styles["link"]}
        to="/presentations/$presentationId"
        params={{ presentationId: presentation.id }}
        aria-label={`${presentation.name}の詳細を見る`}
      >
        <div className={styles["preview"]}>
          {item.state === "published" ? (
            <Thumbnail
              key={item.publication.buildId}
              refreshedAt={refreshedAt}
              src={publicationThumbnailUrl(presentation.id, item.publication.buildId)}
              name={presentation.name}
            />
          ) : (
            <ThumbnailPlaceholder />
          )}
        </div>
        <div className={styles["body"]}>
          <div className={styles["titleRow"]}>
            <h2>{presentation.name}</h2>
            {item.state === "published" ? (
              <span className={styles["published"]}>公開済み</span>
            ) : item.state === "unpublished" ? (
              <span className={styles["unpublished"]}>未公開</span>
            ) : null}
          </div>
          {item.state === "error" ? (
            <p role="alert" className={styles["error"]}>
              {managementErrorMessage(item.error)}
            </p>
          ) : null}
          <span className={styles["action"]}>
            詳細を見る
            <ArrowUpRightIcon aria-hidden="true" />
          </span>
        </div>
      </Link>
    </article>
  );
}
