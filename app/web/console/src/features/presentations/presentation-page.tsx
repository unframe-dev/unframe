import { Skeleton } from "@/shared/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { DeleteConfirmationDialog } from "@/shared/ui/delete-confirmation-dialog";
import { removeRoomQueries, roomKeys } from "@/features/rooms/room-queries";
import { principalRevision } from "@/shared/api/session-events";
import { Button, buttonVariants } from "@/shared/ui/button";
import {
  presentationKeys,
  presentationQueryOptions,
  publicationQueryOptions,
} from "./presentation-queries";
import { deletePresentation, type Presentation, type Room } from "./management-api";
import { ManagementError, managementErrorMessage } from "./management-model";
import { PublicationDetails } from "./publication-details";
import styles from "@/app/shell/application-content.module.css";

export function PresentationPage({ presentationId }: { presentationId: string }) {
  const client = useQueryClient();
  const router = useRouter();
  const presentation = useQuery(presentationQueryOptions(presentationId));
  const publication = useQuery(publicationQueryOptions(presentationId));
  const error = presentation.error ?? publication.error;
  const pending = presentation.isPending || publication.isPending;
  const remove = async (record: Presentation) => {
    const principal = principalRevision();
    const location = router.state.location.href;
    await deletePresentation(record.id, record.revision);
    if (principal !== principalRevision()) return;
    await client.cancelQueries({ queryKey: presentationKeys.list });
    if (principal !== principalRevision()) return;
    client.setQueryData<Presentation[]>(presentationKeys.list, (items) =>
      items?.filter((item) => item.id !== record.id),
    );
    client.removeQueries({ queryKey: presentationKeys.detail(record.id) });
    for (const [, room] of client.getQueriesData<Room>({ queryKey: roomKeys.details })) {
      if (room?.presentationId === record.id) removeRoomQueries(client, room.id);
    }
    await Promise.all([
      client.invalidateQueries({ queryKey: presentationKeys.list }),
      client.resetQueries({ queryKey: roomKeys.owned }),
    ]);
    if (principal === principalRevision() && router.state.location.href === location) {
      await router.navigate({ to: "/home", replace: true });
    }
  };
  const record = presentation.data;
  return (
    <main id="main-content" className={styles["main"]}>
      <header className={styles["heading"]}>
        <h1>{presentation.data?.name ?? "公開済みプレゼンテーションの詳細"}</h1>
      </header>
      <section className="grid gap-5 py-8">
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={presentation.isFetching || publication.isFetching}
            onClick={() =>
              void client.invalidateQueries({ queryKey: presentationKeys.detail(presentationId) })
            }
          >
            公開情報を再取得
          </Button>
          {record && !presentation.isError ? (
            <DeleteConfirmationDialog
              key={`${record.id}:${record.revision}`}
              triggerLabel="プレゼンテーションを削除"
              title="プレゼンテーションを削除しますか？"
              description={`「${record.name}」と公開履歴、アセット、終了済みルームを削除します。この操作は取り消せません。`}
              disabled={presentation.isFetching}
              onConfirm={() => remove(record)}
              errorMessage={(error) =>
                error instanceof ManagementError && error.status === 409
                  ? "削除できませんでした。未終了のルームがあれば終了し、公開情報を再取得してからやり直してください。"
                  : managementErrorMessage(error)
              }
            />
          ) : null}
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
            <Link
              to="/rooms"
              search={{ presentationId }}
              className={buttonVariants({ className: "w-fit" })}
            >
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
