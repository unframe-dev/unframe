import { principalRevision } from "@/shared/api/session-events";
import { Skeleton } from "@/shared/ui/skeleton";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { OwnedRoomList } from "./owned-room-list";
import { RoomSharing } from "./room-sharing";
import { Button } from "@/shared/ui/button";
import { PublicationList } from "@/features/presentations/publication-list";
import {
  createRoom,
  getRoom,
  getRuntimePreparation,
  prepareRuntime,
  startRoom,
  endRoom,
  type Room,
} from "@/features/presentations/management-api";
import { ManagementError, managementErrorMessage } from "@/features/presentations/management-model";
import {
  presentationQueryOptions,
  publicationQueryOptions,
} from "@/features/presentations/presentation-queries";
import { PublicationDetails } from "@/features/presentations/publication-details";
import styles from "@/app/shell/application-content.module.css";

export function RoomDetails({ room }: { room: Room }) {
  return (
    <>
      <dl className="grid gap-3 break-all text-sm">
        <div>
          <dt>ルーム ID</dt>
          <dd>{room.id}</dd>
        </div>
        <div>
          <dt>状態</dt>
          <dd>{room.state}</dd>
        </div>
      </dl>
      <details className="text-sm">
        <summary className="w-fit cursor-pointer text-[var(--muted)]">技術情報</summary>
        <dl className="mt-4 grid gap-3 break-all">
          <div>
            <dt>Presentation ID</dt>
            <dd>{room.presentationId}</dd>
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
      </details>
    </>
  );
}

export function RoomsPage({ presentationId }: { presentationId: string }) {
  const [selectedId, setSelectedId] = useState(presentationId);
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
  const presentation = useQuery(presentationQueryOptions(selectedId));
  const publication = useQuery(publicationQueryOptions(selectedId));
  const initialError = presentation.error ?? publication.error;
  const initialPending = presentation.isPending || publication.isPending;
  const selection =
    !initialError && presentation.data && publication.data
      ? { presentation: presentation.data, publication: publication.data }
      : undefined;
  const mutation = useMutation({
    mutationFn: createRoom,
    retry: false,
    onMutate: () => principalRevision(),
    onSuccess: (result, _presentationId, principal) => {
      if (principal !== principalRevision()) return;
      setCreated(true);
      if (active.current)
        void navigate({ to: "/rooms/$sessionId", params: { sessionId: result.session.id } });
    },
    onError: (error, _presentationId, principal) => {
      if (principal !== principalRevision()) return;
      // A lost response or server error may follow a committed Session creation.
      if (!(error instanceof ManagementError) || error.status >= 500) setUncertain(true);
    },
    onSettled: async (_result, error, _presentationId, principal) => {
      if (principal !== principalRevision()) return;
      if (error) submitting.current = false;
      await client.invalidateQueries({ queryKey: ["owned-rooms"] });
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
      </header>
      <OwnedRoomList />
      <>
        {selectedId && initialPending ? (
          <div
            role="status"
            aria-label="公開情報を読み込んでいます…"
            className="grid gap-4 border-b py-8"
          >
            <Skeleton className="h-7 w-72 max-w-full" />
            <Skeleton className="h-4 w-full max-w-xl" />
            <Skeleton className="h-12 w-36" />
            <Skeleton className="h-5 w-24" />
          </div>
        ) : null}
        {initialError ? (
          <p role="alert">
            {managementErrorMessage(initialError)}{" "}
            <Button
              variant="outline"
              onClick={() => void Promise.all([presentation.refetch(), publication.refetch()])}
            >
              選択情報を再取得
            </Button>
          </p>
        ) : null}
        {selectedId && !initialError && !initialPending && !publication.data ? <p>未公開</p> : null}
        {selection ? (
          <section className="grid gap-4 border-b py-8" aria-label="選択したプレゼンテーション">
            <h2 className="text-xl">{selection.presentation.name}</h2>
            <p className="text-sm">
              作成時の最新公開版を使用します。すべてのルームを終了するまで再公開できません。
            </p>
            <div>
              <Button disabled={mutation.isPending || uncertain || created} onClick={submit}>
                {mutation.isPending ? "作成しています…" : "ルームを作成"}
              </Button>
            </div>
            <PublicationDetails publication={selection.publication} />
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
          onSelect={(id) => {
            if (!mutation.isPending && !uncertain) {
              setSelectedId(id);
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
        {query.isPending ? (
          <div role="status" aria-label="ルームを読み込んでいます…" className="grid gap-6">
            <div className="grid gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-72 max-w-full" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-24" />
            </div>
            <Skeleton className="h-5 w-24" />
            <div className="flex flex-wrap gap-3">
              <Skeleton className="h-12 w-36" />
              <Skeleton className="h-12 w-28" />
            </div>
          </div>
        ) : null}
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
      const principal = principalRevision();
      await client.cancelQueries({ queryKey: preparationKey });
      await client.cancelQueries({ queryKey: roomKey });
      return principal;
    },
    onSuccess: (result, _action, principal) => {
      if (principal !== principalRevision()) return;
      if (result.action === "prepare") client.setQueryData(preparationKey, result.value);
      else {
        client.setQueryData(roomKey, result.value);
        if (result.value.state === "Ended") client.setQueryData(preparationKey, { state: "ended" });
      }
    },
    onError: async (_error, action, principal) => {
      if (principal !== principalRevision()) return;
      if (action !== "prepare") {
        await Promise.all([
          client.invalidateQueries({ queryKey: roomKey }),
          client.invalidateQueries({ queryKey: preparationKey }),
        ]);
      }
    },
    onSettled: async (_result, _error, action, principal) => {
      if (principal !== principalRevision()) return;
      submitting.current = false;
      if (action !== "prepare") await client.invalidateQueries({ queryKey: ["owned-rooms"] });
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
          {preparation.isPending ? (
            <div role="status" aria-label="発表環境を読み込んでいます…">
              <Skeleton className="h-5 w-56 max-w-full" />
            </div>
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
