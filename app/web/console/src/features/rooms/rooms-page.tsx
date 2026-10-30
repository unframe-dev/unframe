import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { OwnedRoomList } from "./owned-room-list";
import { RoomSharing } from "./room-sharing";
import { Button } from "@/shared/ui/button";
import { PublicationList } from "@/features/presentations/publication-list";
import {
  createRoom,
  getPresentation,
  getPublication,
  getRoom,
  getRuntimePreparation,
  prepareRuntime,
  startRoom,
  endRoom,
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
  const [created, setCreated] = useState(false);
  const navigate = useNavigate();
  const client = useQueryClient();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
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
      setCreated(true);
      void client.invalidateQueries({ queryKey: ["owned-rooms"] });
      if (active.current)
        void navigate({ to: "/rooms/$sessionId", params: { sessionId: result.session.id } });
    },
    onError: (error) => {
      // A lost response or server error may follow a committed Session creation.
      if (!(error instanceof ManagementError) || error.status >= 500) setUncertain(true);
    },
    onSettled: (_result, error) => {
      if (error) submitting.current = false;
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
        <p>公開済みプレゼンテーションからルームを作成します。作成時の最新公開版を使います。</p>
      </header>
      <OwnedRoomList />
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
        {initial.isSuccess && !initial.data.publication ? <p>未公開</p> : null}
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
              <Button disabled={mutation.isPending || uncertain || created} onClick={submit}>
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
    </main>
  );
}

export function RoomPage({ sessionId }: { sessionId: string }) {
  const pendingActions = useIsMutating({ mutationKey: ["room-action", sessionId] });
  const query = useQuery({
    queryKey: ["room", sessionId],
    queryFn: ({ signal }) => getRoom(sessionId, signal),
    retry: false,
    refetchInterval: (query) =>
      pendingActions || query.state.data?.state === "Ended" ? false : 5000,
  });
  return (
    <main id="main-content" className={styles["main"]}>
      <header className={styles["heading"]}>
        <h1>ルームの詳細</h1>
        <p>発表環境を準備して、発表を開始・終了します。</p>
      </header>
      <section className="grid gap-5 py-8">
        <div>
          <Button
            variant="outline"
            disabled={query.isFetching || pendingActions > 0}
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
            <RoomControls key={sessionId} room={query.data} />
            <RoomSharing key={`sharing-${sessionId}`} room={query.data} />
          </>
        ) : null}
      </section>
    </main>
  );
}

function RoomControls({ room }: { room: Room }) {
  const client = useQueryClient();
  const submitting = useRef(false);
  const preparationKey = ["runtime-preparation", room.id];
  const roomKey = ["room", room.id];
  const mutation = useMutation({
    mutationKey: ["room-action", room.id],
    mutationFn: async (action: "prepare" | "start" | "end") => {
      if (action === "prepare") return { action, value: await prepareRuntime(room.id) } as const;
      return {
        action,
        value: await (action === "start" ? startRoom(room.id) : endRoom(room.id)),
      } as const;
    },
    retry: false,
    onMutate: async () => {
      await client.cancelQueries({ queryKey: preparationKey });
      await client.cancelQueries({ queryKey: roomKey });
    },
    onSuccess: (result) => {
      if (result.action === "prepare") client.setQueryData(preparationKey, result.value);
      else {
        client.setQueryData(roomKey, result.value);
        if (result.value.state === "Ended") client.setQueryData(preparationKey, { state: "ended" });
      }
    },
    onError: async (_error, action) => {
      if (action !== "prepare") {
        await Promise.all([
          client.invalidateQueries({ queryKey: roomKey }),
          client.invalidateQueries({ queryKey: preparationKey }),
        ]);
      }
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const preparation = useQuery({
    queryKey: preparationKey,
    queryFn: ({ signal }) => getRuntimePreparation(room.id, signal),
    enabled: room.state !== "Ended",
    retry: false,
    refetchInterval: (query) =>
      mutation.isPending || query.state.status === "error" || query.state.data?.state === "ended"
        ? false
        : query.state.data?.state === "starting"
          ? 1000
          : 5000,
  });
  const ended = room.state === "Ended" || preparation.data?.state === "ended";
  const ready = preparation.data?.state === "ready" && !preparation.isError;
  const starting = preparation.data?.state === "starting" && !preparation.isError;
  const busy = mutation.isPending;
  const submit = (action: "prepare" | "start" | "end") => {
    if (ended || submitting.current || (action === "start" && (room.state !== "Waiting" || !ready)))
      return;
    submitting.current = true;
    mutation.mutate(action);
  };
  const error = mutation.error ?? preparation.error;
  const message =
    error instanceof ManagementError && error.code === "runtime_unavailable"
      ? "利用できる発表環境がありません。時間をおいて、もう一度準備してください。"
      : error instanceof ManagementError && error.code === "session_ended"
        ? "このルームの発表は終了しています。ルーム情報を再取得してください。"
        : error instanceof ManagementError && error.status === 409
          ? "ルームの状態が変わりました。ルーム情報を再取得して、もう一度操作してください。"
          : managementErrorMessage(error);
  return (
    <section className="grid gap-4" aria-label="発表の操作">
      {ended ? (
        <p>このルームの発表は終了しました。</p>
      ) : (
        <>
          {starting || (busy && mutation.variables === "prepare") ? (
            <p role="status">発表環境を準備しています。</p>
          ) : null}
          {ready ? <p role="status">発表環境の準備ができました。</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={busy || starting || ready || preparation.isPending}
              onClick={() => submit("prepare")}
            >
              発表環境を準備
            </Button>
            {room.state === "Waiting" ? (
              <Button disabled={busy || !ready} onClick={() => submit("start")}>
                発表を開始
              </Button>
            ) : null}
            <Button variant="outline" disabled={busy} onClick={() => submit("end")}>
              発表を終了
            </Button>
          </div>
        </>
      )}
      {error ? <p role="alert">{message}</p> : null}
    </section>
  );
}
