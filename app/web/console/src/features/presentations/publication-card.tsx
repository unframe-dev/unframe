import { ImageIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
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

function Thumbnail({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <ThumbnailPlaceholder />
  ) : (
    <img
      className={styles["image"]}
      src={src}
      alt={`${name}のサムネイル`}
      loading="lazy"
      decoding="async"
      crossOrigin="use-credentials"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
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
  const content = (
    <>
      <div className={styles["preview"]}>
        {item.state === "published" ? (
          <Thumbnail
            key={`${item.publication.buildId}:${refreshedAt}`}
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
        {item.state === "published" ? (
          <span className={styles["action"]}>
            詳細を見る
            <ArrowUpRightIcon aria-hidden="true" />
          </span>
        ) : null}
      </div>
    </>
  );
  return (
    <article className={styles["card"]} data-interactive={item.state === "published"}>
      {item.state === "published" ? (
        <Link
          className={styles["link"]}
          to="/presentations/$presentationId"
          params={{ presentationId: presentation.id }}
          aria-label={`${presentation.name}の詳細を見る`}
        >
          {content}
        </Link>
      ) : (
        <div className={styles["content"]}>{content}</div>
      )}
    </article>
  );
}
