import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@/shared/ui/button";
import { listRooms } from "@/features/presentations/management-api";
import { managementErrorMessage } from "@/features/presentations/management-model";

export function OwnedRoomList() {
  const query = useInfiniteQuery({
    queryKey: ["owned-rooms"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => listRooms(pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  return (
    <section className="grid gap-4 border-b py-8" aria-label="作成したルーム">
      <div className="flex flex-wrap items-center gap-4">
        <h2 className="text-xl">作成したルーム</h2>
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          ルーム一覧を再取得
        </Button>
      </div>
      {query.isPending ? <p role="status">ルーム一覧を読み込んでいます…</p> : null}
      {query.isError ? <p role="alert">{managementErrorMessage(query.error)}</p> : null}
      {!query.isError && query.data ? (
        <>
          {query.data.pages[0]?.sessions.length === 0 ? <p>作成したルームはありません。</p> : null}
          <ul className="grid gap-3">
            {query.data.pages
              .flatMap((page) => page.sessions)
              .map((room) => (
                <li key={room.id} className="flex flex-wrap items-center gap-4">
                  <Link to="/rooms/$sessionId" params={{ sessionId: room.id }}>
                    {room.id}
                  </Link>
                  <span>{room.state}</span>
                </li>
              ))}
          </ul>
          {query.hasNextPage ? (
            <div>
              <Button
                variant="outline"
                disabled={query.isFetching}
                onClick={() => void query.fetchNextPage()}
              >
                ルームをさらに表示
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
