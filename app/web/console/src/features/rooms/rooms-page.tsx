import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { PublicationList } from "@/features/presentations/publication-list";
import {
  createRoom,
  getPresentation,
  getPublication,
  getRoom,
  type Presentation,
  type Publication,
  type Room,
} from "@/features/presentations/management-api";
import { ManagementError, managementErrorMessage } from "@/features/presentations/management-model";
import { PublicationDetails } from "@/features/presentations/publication-details";
import styles from "@/app/shell/application-content.module.css";

export function RoomDetails({ room }: { room: Room }) {
  return (
    <dl className="grid gap-3 break-all text-sm">
      <div>
        <dt>Session ID</dt>
        <dd>{room.id}</dd>
      </div>
      <div>
        <dt>Presentation ID</dt>
        <dd>{room.presentationId}</dd>
      </div>
      <div>
        <dt>状態</dt>
        <dd>{room.state}</dd>
      </div>
      {room.publicationFence ? (
        <>
          <div>
            <dt>固定 publication epoch</dt>
            <dd>{room.publicationFence.publicationEpoch}</dd>
          </div>
          <div>
            <dt>固定 publication manifest hash</dt>
            <dd>{room.publicationFence.publicationManifestHash}</dd>
          </div>
        </>
      ) : (
        <div>
          <dt>固定 publication</dt>
          <dd>公開版なし</dd>
        </div>
      )}
    </dl>
  );
}

export function RoomsPage({ presentationId }: { presentationId: string }) {
  const [selected, setSelected] = useState<{
    presentation: Presentation;
    publication: Publication;
  }>();
  const [created, setCreated] = useState<Awaited<ReturnType<typeof createRoom>>>();
  const [uncertain, setUncertain] = useState(false);
  const submitting = useRef(false);
  const initial = useQuery({
    queryKey: ["room-selection", presentationId],
    enabled: Boolean(presentationId),
    retry: false,
    queryFn: async () => ({
      presentation: await getPresentation(presentationId),
      publication: await getPublication(presentationId),
    }),
  });
  const selection =
    selected ??
    (initial.data?.publication
      ? { presentation: initial.data.presentation, publication: initial.data.publication }
      : undefined);
  const mutation = useMutation({
    mutationFn: createRoom,
    retry: false,
    onSuccess: (result) => {
      setCreated(result);
    },
    onError: (error) => {
      // A lost response or server error may follow a committed Session creation.
      if (!(error instanceof ManagementError) || error.status >= 500) setUncertain(true);
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const submit = () => {
    if (!selection || submitting.current || uncertain || created) return;
    submitting.current = true;
    mutation.mutate(selection.presentation.id);
  };
  return (
    <main id="main-content" className={styles["main"]}>
      <header className={styles["heading"]}>
        <h1>ルーム</h1>
        <p>公開済み Dist からルームを作成します。作成時の最新公開版を使います。</p>
      </header>
      {created ? (
        <section className="grid gap-5 py-8" aria-label="ルーム作成結果">
          <h2 className="text-xl">ルームを作成しました</h2>
          <RoomDetails room={created.session} />
          <p>
            Join Code: <strong>{created.joinCode}</strong>
          </p>
          <p className="text-sm">
            Join Code は作成直後だけ表示されます。この画面を離れると再表示できません。
          </p>
          <Link to="/rooms/$sessionId" params={{ sessionId: created.session.id }}>
            ルームの詳細
          </Link>
        </section>
      ) : (
        <>
          {presentationId && initial.isPending ? (
            <p role="status">公開情報を読み込んでいます…</p>
          ) : null}
          {initial.isError ? (
            <p role="alert">
              {managementErrorMessage(initial.error)}{" "}
              <Button variant="outline" onClick={() => void initial.refetch()}>
                選択情報を再取得
              </Button>
            </p>
          ) : null}
          {initial.isSuccess && !initial.data.publication ? <p>公開済み Dist なし</p> : null}
          {selection ? (
            <section className="grid gap-4 border-b py-8" aria-label="選択した Presentation">
              <h2 className="text-xl">{selection.presentation.name}</h2>
              <p className="break-all text-sm">Presentation ID: {selection.presentation.id}</p>
              <PublicationDetails publication={selection.publication} />
              <p className="text-sm">
                表示後に公開版が更新された場合、作成時の最新公開版が固定されます。Ended
                でないルームがある間、再公開はできません。
              </p>
              <div>
                <Button disabled={mutation.isPending || uncertain} onClick={submit}>
                  {mutation.isPending ? "作成しています…" : "ルームを作成"}
                </Button>
              </div>
            </section>
          ) : null}
          {mutation.isError ? (
            <p role="alert">
              {uncertain
                ? "作成結果を確認できません。ルームが作成された可能性があります。重複を避けるため、この画面では再送できません。"
                : managementErrorMessage(mutation.error)}
            </p>
          ) : null}
          <PublicationList
            onSelect={(presentation, publication) => {
              if (!mutation.isPending && !uncertain) {
                setSelected({ presentation, publication });
                mutation.reset();
              }
            }}
          />
        </>
      )}
    </main>
  );
}

export function RoomPage({ sessionId }: { sessionId: string }) {
  const query = useQuery({
    queryKey: ["room", sessionId],
    queryFn: () => getRoom(sessionId),
    retry: false,
  });
  return (
    <main id="main-content" className={styles["main"]}>
      <header className={styles["heading"]}>
        <h1>ルームの詳細</h1>
        <p>保存された Session と固定 publication を確認します。</p>
      </header>
      <section className="grid gap-5 py-8">
        <div>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            ルーム情報を再取得
          </Button>
        </div>
        {query.isPending ? <p role="status">ルームを読み込んでいます…</p> : null}
        {query.isError ? <p role="alert">{managementErrorMessage(query.error)}</p> : null}
        {query.isSuccess ? (
          <>
            <RoomDetails room={query.data} />
            <p className="text-sm">
              Join Code は再取得できません。作成直後の画面だけに表示されます。
            </p>
          </>
        ) : null}
      </section>
    </main>
  );
}
