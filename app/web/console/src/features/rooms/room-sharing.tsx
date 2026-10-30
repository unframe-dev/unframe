import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { getRoomCode, rotateRoomCode, type Room } from "@/features/presentations/management-api";
import { managementErrorMessage } from "@/features/presentations/management-model";
import { audienceJoinUrl, invitationQr } from "./room-sharing-model";

export function RoomSharing({ room }: { room: Room }) {
  const client = useQueryClient();
  const key = ["room-code", room.id];
  const submitting = useRef(false);
  const rotationKey = ["room-code-rotation", room.id];
  const rotations = useMutationState({
    filters: { mutationKey: rotationKey },
    select: (mutation) => ({ status: mutation.state.status, error: mutation.state.error }),
  });
  const pending = rotations.some((rotation) => rotation.status === "pending");
  const rotationError = rotations.find((rotation) => rotation.status === "error")?.error;
  const blocked = pending || Boolean(rotationError);
  const [reloading, setReloading] = useState(false);
  const clearRotations = () => {
    for (const rotation of client.getMutationCache().findAll({ mutationKey: rotationKey })) {
      client.getMutationCache().remove(rotation);
    }
  };
  const [qr, setQr] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string>();
  const [copyError, setCopyError] = useState(false);
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const result = await getRoomCode(room.id, signal);
      signal.throwIfAborted();
      client.setQueryData(key, result);
      for (const rotation of client
        .getMutationCache()
        .findAll({ mutationKey: rotationKey, status: "error" })) {
        client.getMutationCache().remove(rotation);
      }
      return result;
    },
    enabled: room.state !== "Ended",
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const mutation = useMutation({
    mutationKey: rotationKey,
    mutationFn: () => rotateRoomCode(room.id),
    retry: false,
    // A lost rotation response remains uncertain across navigation until a fresh read succeeds.
    gcTime: Infinity,
    onMutate: async () => {
      await client.cancelQueries({ queryKey: key });
    },
    onSuccess: async (result) => {
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, result);
      clearRotations();
    },
    onError: async () => {
      await client.cancelQueries({ queryKey: key });
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const reload = async () => {
    setReloading(true);
    try {
      const result = await query.refetch();
      if (result.isSuccess) mutation.reset();
    } finally {
      setReloading(false);
    }
  };
  const rotate = () => {
    if (submitting.current || query.isFetching || blocked || room.state === "Ended") return;
    submitting.current = true;
    mutation.mutate();
  };
  if (room.state === "Ended") return null;
  const code = !blocked && !reloading && !query.isError ? query.data?.joinCode : undefined;
  let url: string | undefined;
  let originError = false;
  if (code) {
    try {
      url = audienceJoinUrl(code);
    } catch {
      originError = true;
    }
  }
  const error = query.error ?? rotationError;
  return (
    <section className="grid gap-4 border-t py-6" aria-label="ルームへの参加・共有">
      <h2 className="text-xl">参加・共有</h2>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={pending || query.isFetching}
          onClick={() => void reload()}
        >
          参加コードを再取得
        </Button>
        <Button
          variant="outline"
          disabled={pending || query.isFetching || blocked || !code}
          onClick={rotate}
        >
          参加コードを更新
        </Button>
      </div>
      {query.isPending || pending ? <p role="status">参加コードを読み込んでいます…</p> : null}
      {error ? (
        <p role="alert">
          {managementErrorMessage(error)}
          {blocked ? " 現在の参加コードを再取得してから共有してください。" : ""}
        </p>
      ) : null}
      {code ? (
        <p>
          参加コード: <strong>{code}</strong>
        </p>
      ) : null}
      {originError ? (
        <p role="alert">Audience の接続先に有効な HTTPS origin を設定してください。</p>
      ) : null}
      {url ? (
        <>
          <p className="break-all">
            <a href={url} target="_blank" rel="noreferrer">
              匿名 Viewer で開く
            </a>
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setCopyError(false);
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopiedUrl(url);
                  } catch {
                    setCopyError(true);
                  }
                })();
              }}
            >
              参加 URL をコピー
            </Button>
            <Button variant="outline" onClick={() => setQr(true)}>
              QR コードを生成
            </Button>
          </div>
          {copiedUrl === url ? <p role="status">参加 URL をコピーしました。</p> : null}
          {copyError ? <p role="alert">参加 URL をコピーできませんでした。</p> : null}
          {qr ? (
            <img
              className="w-64 max-w-full"
              src={invitationQr(url)}
              alt="匿名 Viewer 参加用 QR コード"
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
