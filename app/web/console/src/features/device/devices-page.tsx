import { Skeleton } from "@/shared/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { z } from "zod";
import { controlPlaneAuth as auth } from "@/features/auth/control-plane-auth";
import { Button } from "@/shared/ui/button";
import styles from "@/app/shell/application-content.module.css";

const timestampSchema = z.union([z.date(), z.iso.datetime().transform((value) => new Date(value))]);
const sessionSchema = z.object({
  id: z.string().min(1),
  assurance: z.string().optional(),
  userAgent: z.string().nullable().optional(),
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
});

async function listDevices({ signal }: { signal: AbortSignal }) {
  const result = await auth.listSessions({ fetchOptions: { signal } });
  signal.throwIfAborted();
  if (result.error) throw new Error("device-sessions-unavailable");
  return z
    .array(sessionSchema)
    .parse(result.data)
    .filter(
      (session) => session.assurance === "device" && session.expiresAt.getTime() > Date.now(),
    );
}

export function DevicesPage() {
  const query = useQuery({
    queryKey: ["device-sessions"],
    queryFn: listDevices,
    retry: false,
    gcTime: 0,
  });
  return (
    <main id="main-content" className={styles["main"]}>
      <header className={styles["heading"]}>
        <h1>デバイス</h1>
      </header>
      <section className="grid gap-5 py-8" aria-label="認証済みデバイス">
        <div className="flex flex-wrap items-center gap-4">
          <Link to="/device" search={{ user_code: "" }}>
            デバイスを承認
          </Link>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            デバイス一覧を再取得
          </Button>
        </div>
        {query.isPending ? (
          <div role="status" aria-label="デバイスを読み込んでいます…" className="grid gap-5">
            {[0, 1, 2].map((row) => (
              <div key={row} className="grid gap-3">
                <Skeleton className="h-6 w-48 max-w-full" />
                <Skeleton className="h-4 w-64 max-w-full" />
                <Skeleton className="h-4 w-56 max-w-full" />
              </div>
            ))}
          </div>
        ) : null}
        {query.isError ? (
          <p role="alert">
            デバイスを読み込めませんでした。ログイン状態を確認して再取得してください。
          </p>
        ) : null}
        {query.isSuccess && query.data.length === 0 ? (
          <p>認証済みのデバイスはありません。</p>
        ) : null}
        {query.isSuccess ? (
          <ul className="grid gap-5">
            {query.data.map((device) => (
              <li key={device.id}>
                <h2 className="break-all text-lg">{device.userAgent || "認証済み端末"}</h2>
                <dl className="grid gap-2 text-sm">
                  <div>
                    <dt>承認日時</dt>
                    <dd>{device.createdAt.toLocaleString("ja-JP")}</dd>
                  </div>
                  <div>
                    <dt>有効期限</dt>
                    <dd>{device.expiresAt.toLocaleString("ja-JP")}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
